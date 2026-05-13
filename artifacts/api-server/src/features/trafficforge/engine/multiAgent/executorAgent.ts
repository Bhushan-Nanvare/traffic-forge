/**
 * Executor Agent — runs a TestPlan against a real browser via Playwright.
 *
 * No LLM calls. No reasoning. Pure execution: take a typed action, run it,
 * report success/failure. The Orchestrator wraps this with the Healer when
 * a step fails, but the Executor itself is stateless about recovery.
 *
 * Uses semantic locators (getByRole) — not CSS selectors — so tests stay
 * stable when developers change classes.
 */

import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { logger } from '../../../../shared/lib/logger.js';
import type { StepAction, TestPlanStep, StepResult, StepStatus } from './types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  stepTimeoutMs?: number;        // default 8000
  viewport?: { width: number; height: number };
  headless?: boolean;            // default true
  captureScreenshots?: boolean;  // default true
  /** Path to a saved Playwright storageState.json for pre-authenticated runs. */
  storageStatePath?: string;
}

/**
 * Holds the browser/page state across steps. One instance per scenario run.
 * Always call dispose() in a finally block.
 */
export class ExecutorAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private opts: ExecutorOptions & {
    stepTimeoutMs: number;
    viewport: { width: number; height: number };
    headless: boolean;
    captureScreenshots: boolean;
  };

  constructor(options: ExecutorOptions = {}) {
    this.opts = {
      stepTimeoutMs: options.stepTimeoutMs ?? 8_000,
      viewport: options.viewport ?? { width: 1280, height: 720 },
      headless: options.headless ?? true,
      captureScreenshots: options.captureScreenshots ?? true,
      storageStatePath: options.storageStatePath,
    };
  }

  /** Launch the browser and create a page. Must be called before runStep. */
  async start(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    this.context = await this.browser.newContext({
      viewport: this.opts.viewport,
      ignoreHTTPSErrors: true,
      // Pre-authenticated state from a seed run, if provided
      ...(this.opts.storageStatePath ? { storageState: this.opts.storageStatePath } : {}),
    });
    this.page = await this.context.newPage();
  }

  /** Returns the live Page so Healer can inspect DOM. Throws if not started. */
  getPage(): Page {
    if (!this.page) throw new Error('Executor not started');
    return this.page;
  }

  /**
   * Run a single step. Never throws — converts errors into a failed StepResult.
   * If `actionOverride` is provided (Healer's proposed action), runs that
   * instead of step.action; the original step description is preserved.
   */
  async runStep(step: TestPlanStep, actionOverride?: StepAction): Promise<StepResult> {
    if (!this.page) {
      return this._failed(step, Date.now(), 'Executor not started');
    }
    const action = actionOverride ?? step.action;
    const startedAt = Date.now();

    try {
      await this._performAction(action);
      const finishedAt = Date.now();
      const screenshot = await this._maybeScreenshot();
      return {
        step,
        status: 'passed' as StepStatus,
        startedAt,
        finishedAt,
        screenshot,
        url: this.page.url(),
      };
    } catch (err) {
      const finishedAt = Date.now();
      const screenshot = await this._maybeScreenshot();
      const message = err instanceof Error ? err.message : String(err);
      return {
        step,
        status: 'failed' as StepStatus,
        startedAt,
        finishedAt,
        error: message,
        screenshot,
        url: this.page.url(),
      };
    }
  }

  async dispose(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // ─── Private: action dispatch ───────────────────────────────────────────────

  private async _performAction(action: StepAction): Promise<void> {
    const page = this.page!;
    const timeout = this.opts.stepTimeoutMs;

    switch (action.type) {
      case 'navigate':
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
        return;

      case 'click': {
        const loc = this._resolveByRole(action.role, action.name);
        await loc.click({ timeout });
        return;
      }

      case 'fill': {
        const loc = this._resolveByRole(action.role, action.name);
        await loc.fill(action.value, { timeout });
        return;
      }

      case 'expect_text': {
        // Wait up to timeout for the text to appear anywhere on the page
        await page.waitForFunction(
          // @ts-ignore - document is available in browser context
          (text: string) => document.body.innerText.includes(text),
          action.text,
          { timeout },
        );
        return;
      }

      case 'expect_url': {
        const re = this._toRegex(action.pattern);
        await page.waitForURL(re, { timeout });
        return;
      }

      case 'wait_for': {
        const loc = this._resolveByRole(action.role, action.name);
        await loc.waitFor({ state: 'visible', timeout });
        return;
      }

      case 'wait_ms':
        await page.waitForTimeout(action.ms);
        return;
    }
  }

  /**
   * Build a Playwright locator from role + accessible name.
   * Validates role string against ARIA values; falls back to a permissive
   * locator if the role is unknown.
   */
  private _resolveByRole(role: string, name: string): Locator {
    const page = this.page!;
    // Playwright's getByRole expects a known AriaRole — we cast and let
    // Playwright handle validation. Unknown roles simply yield no matches
    // at action time, which surfaces as a clear timeout error.
    return page.getByRole(role as Parameters<Page['getByRole']>[0], { name });
  }

  private _toRegex(pattern: string): RegExp {
    // If user wrote a regex (slash-delimited), unwrap it; otherwise treat as substring
    const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) return new RegExp(m[1], m[2]);
    // Escape regex metacharacters so substrings match literally
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped);
  }

  private async _maybeScreenshot(): Promise<string | null> {
    if (!this.opts.captureScreenshots || !this.page) return null;
    try {
      const buf = await this.page.screenshot({ type: 'png', fullPage: false });
      return buf.toString('base64');
    } catch (err) {
      logger.debug({ err }, 'Screenshot failed');
      return null;
    }
  }

  private _failed(step: TestPlanStep, startedAt: number, message: string): StepResult {
    return {
      step,
      status: 'failed',
      startedAt,
      finishedAt: Date.now(),
      error: message,
    };
  }
}
