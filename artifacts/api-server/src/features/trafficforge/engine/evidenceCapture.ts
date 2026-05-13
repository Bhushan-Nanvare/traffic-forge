import type { Page } from 'playwright';
import { createHash } from 'crypto';

// ─── Evidence Types ────────────────────────────────────────────────────────────

export type FailureSeverity = 'crash' | 'http_error' | 'network' | 'console_error' | 'navigation_failure' | 'slow';

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  timestamp: number;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number | null;
  failed: boolean;
  failureReason?: string;
  durationMs: number;
  timestamp: number;
}

export interface StepEvidence {
  screenshotBefore: string | null;  // base64 PNG
  screenshotAfter: string | null;
  urlBefore: string;
  urlAfter: string;
  domSnapshotBefore: string | null; // full outerHTML before action (truncated to 50KB)
  domSnapshotAfter: string | null;  // full outerHTML after action (truncated to 50KB)
  consoleLogs: ConsoleEntry[];
  networkRequests: NetworkEntry[];
  domMutated: boolean;
  networkFired: boolean;
}

export interface DetectedFailure {
  type: FailureSeverity;
  message: string;
  stack?: string;
  url?: string;
  status?: number;
  fingerprint: string;         // sha1 hash for deduplication
  stepIndex: number;
  elementSelector: string;
  elementText: string;
  evidence: StepEvidence;
  llmNarrative?: LLMNarrative; // filled in at report time
}

export interface LLMNarrative {
  cause: string;
  fix: string;
  model: string;
}

export interface SwarmStep {
  index: number;
  elementSelector: string;
  elementText: string;
  actionType: 'click' | 'navigate' | 'type' | 'scroll';
  timestamp: number;
  durationMs: number;
  evidence: StepEvidence;
  failures: DetectedFailure[];
  verificationResult: 'dom_changed' | 'network_fired' | 'url_changed' | 'no_change' | 'skipped';
}

export interface SwarmRunSummary {
  runId: string;
  targetUrl: string;
  totalSteps: number;
  totalFailures: number;
  uniqueBugs: number;
  severityCounts: Record<FailureSeverity, number>;
  steps: SwarmStep[];
  failures: DetectedFailure[];       // deduplicated by fingerprint
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

// ─── Evidence Capture ─────────────────────────────────────────────────────────

export class EvidenceCapture {
  private consoleLogs: ConsoleEntry[] = [];
  private networkRequests: NetworkEntry[] = [];
  private requestStartTimes = new Map<string, number>();

  /**
   * Attach Playwright event listeners to the page. Call once after page creation.
   */
  attach(page: Page): void {
    page.on('console', (msg) => {
      const level = msg.type() as ConsoleEntry['level'];
      if (['log', 'info', 'warn', 'error', 'debug'].includes(level)) {
        this.consoleLogs.push({ level, text: msg.text(), timestamp: Date.now() });
      }
    });

    page.on('request', (req) => {
      this.requestStartTimes.set(req.url(), Date.now());
    });

    page.on('response', (res) => {
      const start = this.requestStartTimes.get(res.url()) ?? Date.now();
      this.networkRequests.push({
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
        failed: false,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      });
      this.requestStartTimes.delete(res.url());
    });

    page.on('requestfailed', (req) => {
      const start = this.requestStartTimes.get(req.url()) ?? Date.now();
      this.networkRequests.push({
        url: req.url(),
        method: req.method(),
        status: null,
        failed: true,
        failureReason: req.failure()?.errorText ?? 'unknown',
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      });
      this.requestStartTimes.delete(req.url());
    });
  }

  /** Drain console + network buffers collected since last call. */
  drain(): { consoleLogs: ConsoleEntry[]; networkRequests: NetworkEntry[] } {
    const consoleLogs = this.consoleLogs.splice(0);
    const networkRequests = this.networkRequests.splice(0);
    return { consoleLogs, networkRequests };
  }

  /** Take a screenshot and return base64 PNG string, or null on failure. */
  static async screenshot(page: Page): Promise<string | null> {
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      return buf.toString('base64');
    } catch {
      return null;
    }
  }

  /** Capture full DOM snapshot (truncated to 50 KB). */
  static async domSnapshot(page: Page): Promise<string | null> {
    try {
      // @ts-ignore - document is available inside page.evaluate browser context
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      return typeof html === 'string' ? html.slice(0, 50_000) : null;
    } catch {
      return null;
    }
  }

  /** Check if the DOM body has any visible children (page blank check). */
  static async isBlankPage(page: Page): Promise<boolean> {
    try {
      // @ts-ignore - document is available inside page.evaluate browser context
      const count = await page.evaluate(() => document.body?.children.length ?? 0);
      return count === 0;
    } catch {
      return false;
    }
  }
}

// ─── Failure Fingerprinting ────────────────────────────────────────────────────

/**
 * Deterministic fingerprint so identical errors from different steps
 * collapse into the same bug group.
 */
export function fingerprintFailure(
  type: FailureSeverity,
  message: string,
  elementSelector: string,
): string {
  const raw = `${type}::${message.slice(0, 200)}::${elementSelector}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

/** Severity rank — higher = more important. */
const SEVERITY_RANK: Record<FailureSeverity, number> = {
  crash: 5,
  http_error: 4,
  network: 3,
  console_error: 2,
  navigation_failure: 1,
  slow: 0,
};

export function compareSeverity(a: FailureSeverity, b: FailureSeverity): number {
  return SEVERITY_RANK[b] - SEVERITY_RANK[a];
}
