/**
 * Seed authentication — run once to log into the target site and persist
 * cookies / localStorage as a Playwright `storageState` JSON.
 *
 * The Scenario orchestrator reuses that state on every run so the Planner
 * doesn't waste tokens describing the login flow over and over, and so the
 * Executor doesn't have to re-authenticate before every test.
 *
 * Inspired by the v2 intent-swarm implementation. Uses the same semantic
 * locators (getByRole) as the rest of the multi-agent system.
 */

import { chromium, type Browser } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../../shared/lib/logger.js';

export interface SeedAuthOptions {
  loginUrl: string;
  /** Visible label of the username/email field (matched by accessible name). */
  usernameField: string;
  /** Visible label of the password field. */
  passwordField: string;
  /** Visible label of the submit button. */
  submitButton: string;
  username: string;
  password: string;
  /** Where to write the storageState.json. Created if missing. */
  outputPath: string;
  /** Default: true. Set false to watch the login happen. */
  headless?: boolean;
  /** Optional substring/regex the URL must match after login to confirm success. */
  expectUrl?: string;
}

export class SeedAuthError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SeedAuthError';
  }
}

/**
 * Performs a login against the target site and writes the resulting
 * storage state to disk. Returns the absolute path to the saved file.
 */
export async function seedAuth(opts: SeedAuthOptions): Promise<string> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: opts.headless ?? true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    await page.goto(opts.loginUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    await page
      .getByRole('textbox', { name: opts.usernameField })
      .fill(opts.username, { timeout: 5_000 });
    await page
      .getByRole('textbox', { name: opts.passwordField })
      .fill(opts.password, { timeout: 5_000 });
    await page
      .getByRole('button', { name: opts.submitButton })
      .click({ timeout: 5_000 });

    // Wait for any post-login navigation or async auth flow to settle.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Optional URL assertion to fail fast on bad credentials.
    if (opts.expectUrl) {
      const currentUrl = page.url();
      if (!currentUrl.includes(opts.expectUrl)) {
        throw new SeedAuthError(
          `Login may have failed: expected URL to contain "${opts.expectUrl}" but got "${currentUrl}"`,
          'LOGIN_NOT_VERIFIED',
        );
      }
    }

    const absPath = path.resolve(opts.outputPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await context.storageState({ path: absPath });

    logger.info({ outputPath: absPath, loginUrl: opts.loginUrl }, 'Seed auth saved');
    return absPath;
  } catch (err) {
    if (err instanceof SeedAuthError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SeedAuthError(`Seed auth failed: ${message}`, 'SEED_FAILED');
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Loads a previously saved storageState file. Returns null if it doesn't
 * exist (so callers can degrade to running unauthenticated).
 */
export async function loadStorageState(filePath: string): Promise<string | null> {
  const absPath = path.resolve(filePath);
  try {
    await fs.access(absPath);
    return absPath;
  } catch {
    return null;
  }
}
