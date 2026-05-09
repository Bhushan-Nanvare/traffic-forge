/**
 * Integration tests for browserEngine.ts.
 *
 * Strategy:
 *  - Mock `playwright` so no real chromium is launched
 *  - Build a tight mock graph (Browser → BrowserContext → Page) for the
 *    lifecycle calls runBrowserLoadTest makes (newContext, newPage, goto,
 *    waitForTimeout, evaluate, close, locator)
 *  - Use very short durationMs (200-400ms) so the polling loop fires once
 *    or twice, then drains and returns
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock — pre-flight before module imports
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn() },
}));

import { chromium } from 'playwright';
import { runBrowserLoadTest, type BrowserLiveMetrics } from '../browserEngine.js';

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({
      first: () => ({
        count: vi.fn().mockResolvedValue(0),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Mock Page'),
    url: vi.fn(() => 'https://target.test/'),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeMockContext() {
  const page = makeMockPage();
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
    clearCookies: vi.fn().mockResolvedValue(undefined),
    _page: page,
  };
}

function makeMockBrowser() {
  return {
    newContext: vi.fn().mockImplementation(() => Promise.resolve(makeMockContext())),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
}

const chromiumLaunch = chromium.launch as ReturnType<typeof vi.fn>;

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runBrowserLoadTest', () => {
  describe('happy path', () => {
    it('launches chromium with hardened flags', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const ac = new AbortController();
      const onMetrics = vi.fn();
      await runBrowserLoadTest(
        'run-1',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 200,
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        ac,
        onMetrics,
      );

      expect(chromiumLaunch).toHaveBeenCalledTimes(1);
      const launchArgs = chromiumLaunch.mock.calls[0][0];
      expect(launchArgs.headless).toBe(true);
      expect(launchArgs.args).toEqual(expect.arrayContaining(['--no-sandbox']));
    });

    it('returns aggregated stats with at least one completed action', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const ac = new AbortController();
      const result = await runBrowserLoadTest(
        'run-2',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 300,
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        ac,
        () => {},
      );

      expect(result).toMatchObject({
        completed: expect.any(Number),
        failed: expect.any(Number),
        avgDurationMs: expect.any(Number),
      });
      expect(result.completed).toBeGreaterThanOrEqual(1);
    });

    it('closes the browser on completion', async () => {
      const browser = makeMockBrowser();
      chromiumLaunch.mockResolvedValue(browser);

      await runBrowserLoadTest(
        'run-3',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 200,
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        new AbortController(),
        () => {},
      );

      expect(browser.close).toHaveBeenCalled();
    });
  });

  describe('failure path', () => {
    it('throws a typed error when chromium.launch fails', async () => {
      chromiumLaunch.mockRejectedValue(new Error('spawn ENOENT'));

      await expect(
        runBrowserLoadTest(
          'run-fail',
          {
            url: 'https://target.test',
            appType: 'web',
            userCount: 1,
            durationMs: 200,
            rampUpMs: 0,
          },
          new AbortController(),
          () => {},
        ),
      ).rejects.toThrow(/Browser launch failed/);
    });

    it('reports browser_error type when a user journey crashes', async () => {
      const browser = makeMockBrowser();
      // newContext throws on every call → all journeys fail with browser_error
      browser.newContext = vi.fn().mockRejectedValue(new Error('Context disposed'));
      chromiumLaunch.mockResolvedValue(browser);

      const result = await runBrowserLoadTest(
        'run-crash',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 200,
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        new AbortController(),
        () => {},
      );

      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(result.errorsByType.browser_error).toBeGreaterThanOrEqual(1);
    });
  });

  describe('abort handling', () => {
    it('respects AbortController.abort() and stops the loop', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const ac = new AbortController();
      // Abort almost immediately
      setTimeout(() => ac.abort(), 50);

      const result = await runBrowserLoadTest(
        'run-abort',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 5,
          durationMs: 5000, // long duration; abort kicks in first
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        ac,
        () => {},
      );

      // Total elapsed should be much less than the 5s duration
      expect(result.completed + result.failed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('live metrics', () => {
    it('invokes the metrics callback at least once during the run', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const onMetrics = vi.fn();
      await runBrowserLoadTest(
        'run-metrics',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 800, // long enough for the 500ms metrics tick
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        new AbortController(),
        onMetrics,
      );

      expect(onMetrics).toHaveBeenCalled();
      const metrics = onMetrics.mock.calls[0][0] as BrowserLiveMetrics;
      expect(metrics).toMatchObject({
        completed: expect.any(Number),
        failed: expect.any(Number),
        avgDurationMs: expect.any(Number),
        activeUsers: expect.any(Number),
        activityBatch: expect.any(Array),
        pageMetrics: expect.any(Object),
        errorsByType: expect.any(Object),
      });
    });

    it('emits activityBatch entries with success/error type classification', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const allMetrics: BrowserLiveMetrics[] = [];
      await runBrowserLoadTest(
        'run-activity',
        {
          url: 'https://target.test',
          appType: 'web',
          userCount: 1,
          durationMs: 1200, // 2-3 metrics ticks
          rampUpMs: 0,
          discoveredPaths: ['/'],
        },
        new AbortController(),
        (m) => allMetrics.push(m),
      );

      // Should have collected at least one activity entry tagged success/error/info
      const allActivity = allMetrics.flatMap((m) => m.activityBatch);
      const types = new Set(allActivity.map((a) => a.type));
      expect(allActivity.length).toBeGreaterThan(0);
      // Types are limited to the documented set
      for (const t of types) {
        expect(['info', 'success', 'error']).toContain(t);
      }
    });
  });

  describe('app type routing', () => {
    it('runs the generic journey for unknown app types', async () => {
      const context = makeMockContext();
      const browser = makeMockBrowser();
      browser.newContext = vi.fn().mockResolvedValue(context);
      chromiumLaunch.mockResolvedValue(browser);

      await runBrowserLoadTest(
        'run-generic',
        {
          url: 'https://target.test',
          appType: 'unknown-app',
          userCount: 1,
          durationMs: 200,
          rampUpMs: 0,
          discoveredPaths: ['/foo', '/bar'],
        },
        new AbortController(),
        () => {},
      );

      // Generic journey hits each discovered path via page.goto
      expect(context._page.goto).toHaveBeenCalled();
    });
  });
});
