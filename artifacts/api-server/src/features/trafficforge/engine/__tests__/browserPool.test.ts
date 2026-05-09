/**
 * Integration tests for browserPool.ts.
 *
 * Strategy:
 *  - Mock the 'playwright' module so no real browser is launched.
 *  - Build a tight mock graph (Browser → BrowserContext → Page) where
 *    page.context() returns the exact same context object that was pooled,
 *    which is required for BrowserPool.release() to find the right entry.
 *  - Use vi.useFakeTimers() only for the retry/failure path to avoid 1.5s delay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted before imports by Vitest's transform.
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn() },
}));

// Import AFTER mock declaration so the mock is active when browserPool.ts loads.
import { chromium } from 'playwright';
import { BrowserPool } from '../browserPool.js';

// ─── Mock Factory Helpers ─────────────────────────────────────────────────────

/** Creates a linked (context → page) mock pair where page.context() returns the context. */
function makeContextPagePair() {
  const mockPage = {
    close: vi.fn().mockResolvedValue(undefined),
    context: vi.fn(),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };

  // Wire page back to its context so BrowserPool.release() can find it.
  mockPage.context.mockReturnValue(mockContext);

  return { mockContext, mockPage };
}

/** Creates a mock browser whose newContext() produces correctly linked context/page pairs. */
function makeMockBrowser() {
  const mockBrowser = {
    newContext: vi.fn().mockImplementation(() => {
      const { mockContext } = makeContextPagePair();
      return Promise.resolve(mockContext);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return mockBrowser;
}

const chromiumLaunch = chromium.launch as ReturnType<typeof vi.fn>;

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BrowserPool', () => {
  describe('launch', () => {
    it('launches the requested number of browsers', async () => {
      chromiumLaunch
        .mockResolvedValueOnce(makeMockBrowser())
        .mockResolvedValueOnce(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 2 });
      await pool.launch(2);

      const stats = pool.healthCheck();
      expect(stats.totalBrowsers).toBe(2);
      expect(stats.totalLaunched).toBe(2);
    });

    it('creates contextsPerBrowser contexts per browser', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 3 });
      await pool.launch(1);

      const stats = pool.healthCheck();
      expect(stats.freeContexts).toBe(3);
      expect(stats.activeContexts).toBe(0);
    });

    it('caps launches at maxBrowsers', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ maxBrowsers: 2, contextsPerBrowser: 1 });
      await pool.launch(10); // request more than the cap

      const stats = pool.healthCheck();
      expect(stats.totalBrowsers).toBe(2);
    });

    it('increments failedLaunches when chromium.launch throws', async () => {
      // Always reject so all 3 retry attempts fail.
      chromiumLaunch.mockRejectedValue(new Error('spawn ENOENT'));

      vi.useFakeTimers();

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      const launchPromise = pool.launch(1);

      // Advance past all retry back-off delays (500ms + 1000ms + 1500ms = 3000ms).
      await vi.runAllTimersAsync();
      await launchPromise;

      const stats = pool.healthCheck();
      expect(stats.failedLaunches).toBe(1);
      expect(stats.totalBrowsers).toBe(0);
      expect(stats.totalLaunched).toBe(0);
    });

    it('continues launching other browsers if one fails', async () => {
      const goodBrowser = makeMockBrowser();
      // Browser 0: 3 retries all reject. Browser 1: succeeds.
      chromiumLaunch
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockRejectedValueOnce(new Error('fail-3'))
        .mockResolvedValueOnce(goodBrowser);

      vi.useFakeTimers();

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      const launchPromise = pool.launch(2);
      await vi.runAllTimersAsync();
      await launchPromise;

      const stats = pool.healthCheck();
      expect(stats.failedLaunches).toBe(1);
      expect(stats.totalLaunched).toBe(1);
      expect(stats.totalBrowsers).toBe(1);
    });
  });

  describe('getPage', () => {
    it('returns a Page from a free context', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);

      const page = await pool.getPage();
      expect(page).not.toBeNull();
    });

    it('marks the context as in-use after getPage', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);

      await pool.getPage();

      const stats = pool.healthCheck();
      expect(stats.activeContexts).toBe(1);
      expect(stats.freeContexts).toBe(0);
    });

    it('returns null when all contexts are in-use', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);

      await pool.getPage(); // occupies the only context
      const page2 = await pool.getPage();

      expect(page2).toBeNull();
    });

    it('returns null when the pool has not been launched', async () => {
      const pool = new BrowserPool();
      const page = await pool.getPage();
      expect(page).toBeNull();
    });
  });

  describe('release', () => {
    it('marks the context as free and closes the page', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);

      const page = await pool.getPage();
      expect(page).not.toBeNull();

      await pool.release(page!);

      const stats = pool.healthCheck();
      expect(stats.freeContexts).toBe(1);
      expect(stats.activeContexts).toBe(0);
      // The page itself should have been closed.
      expect((page as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    });

    it('allows the released context to be reused immediately', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);

      const page1 = await pool.getPage();
      await pool.release(page1!);

      const page2 = await pool.getPage();
      expect(page2).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('closes all contexts and browsers, then empties internal state', async () => {
      const browser = makeMockBrowser();
      chromiumLaunch.mockResolvedValue(browser);

      const pool = new BrowserPool({ contextsPerBrowser: 2 });
      await pool.launch(1);
      await pool.cleanup();

      const stats = pool.healthCheck();
      expect(stats.totalBrowsers).toBe(0);
      expect(stats.freeContexts).toBe(0);
      expect(stats.activeContexts).toBe(0);
      expect(browser.close).toHaveBeenCalled();
    });

    it('is idempotent — calling cleanup twice does not throw', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 1 });
      await pool.launch(1);
      await pool.cleanup();
      await expect(pool.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('reflects zero stats on a fresh pool', () => {
      const pool = new BrowserPool();
      expect(pool.healthCheck()).toEqual({
        totalBrowsers: 0,
        activeContexts: 0,
        freeContexts: 0,
        totalLaunched: 0,
        failedLaunches: 0,
        recoveries: 0,
        avgLaunchLatencyMs: 0,
      });
    });

    it('tracks activeContexts correctly across get/release cycles', async () => {
      chromiumLaunch.mockResolvedValue(makeMockBrowser());

      const pool = new BrowserPool({ contextsPerBrowser: 2 });
      await pool.launch(1);

      const p1 = await pool.getPage();
      const p2 = await pool.getPage();

      expect(pool.healthCheck().activeContexts).toBe(2);

      await pool.release(p1!);
      expect(pool.healthCheck().activeContexts).toBe(1);

      await pool.release(p2!);
      expect(pool.healthCheck().activeContexts).toBe(0);
    });
  });
});
