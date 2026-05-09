/**
 * Integration tests for loadEngine.ts.
 *
 * Strategy:
 *  - Stub `globalThis.fetch` to return controlled responses (no network).
 *  - Use very short durations (250-600ms) and aggressive think time (respectRateLimits=false)
 *    so each test stays under ~2 seconds.
 *  - Assert on the final returned metrics shape and on the callback contract.
 *  - Avoid asserting exact timings; assert ranges and ordering instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRealLoadTest, type LoadConfig, type LiveMetrics } from '../loadEngine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

interface FetchBehavior {
  status?: number;
  body?: string;
  /** Latency in ms before the response resolves. */
  latencyMs?: number;
  /** If set, fetch throws this error instead of resolving. */
  throwError?: Error;
  /** If set, the response never resolves (forces a timeout). */
  hang?: boolean;
}

function makeFetchMock(behavior: FetchBehavior | (() => FetchBehavior)) {
  return vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    const b = typeof behavior === 'function' ? behavior() : behavior;
    const signal = init?.signal;

    // Honor an already-aborted signal up front.
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (b.throwError) throw b.throwError;

    if (b.hang) {
      // Hang until the AbortController times out the request.
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    }

    if (b.latencyMs && b.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, b.latencyMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    }

    return new Response(b.body ?? 'ok', {
      status: b.status ?? 200,
      headers: { 'content-type': 'text/plain' },
    });
  });
}

function buildConfig(overrides: Partial<LoadConfig> = {}): LoadConfig {
  return {
    url: 'https://test.example.com',
    paths: ['/'],
    userCount: 2,
    durationMs: 400,
    rampUpMs: 0,
    respectRateLimits: false,
    autoStopErrorThreshold: 100,
    timeoutMs: 1500,
    ...overrides,
  };
}

// ─── Test Setup ───────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('runRealLoadTest', () => {
  describe('happy path', () => {
    it('returns valid metrics shape after a short successful run', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();
      const onMetrics = vi.fn<(m: LiveMetrics) => void>();

      const result = await runRealLoadTest('run-1', buildConfig(), ac, onMetrics);

      expect(result).toMatchObject({
        completed: expect.any(Number),
        failed: expect.any(Number),
        totalRequests: expect.any(Number),
        avgResponseMs: expect.any(Number),
        p50Ms: expect.any(Number),
        p95Ms: expect.any(Number),
        p99Ms: expect.any(Number),
        errorRate: expect.any(Number),
        pageMetrics: expect.any(Object),
        errorBreakdown: expect.any(Object),
      });
      expect(result.totalRequests).toBeGreaterThan(0);
      expect(result.completed).toBe(result.totalRequests);
      expect(result.failed).toBe(0);
      expect(result.errorRate).toBe(0);
    });

    it('keeps percentile ordering p50 <= p95 <= p99', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-2',
        buildConfig({ userCount: 3, durationMs: 500 }),
        ac,
        () => {},
      );

      expect(result.p50Ms).toBeLessThanOrEqual(result.p95Ms);
      expect(result.p95Ms).toBeLessThanOrEqual(result.p99Ms);
    });

    it('records page metrics per path with count and zero errors', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const config = buildConfig({ paths: ['/a', '/b', '/c'], userCount: 3, durationMs: 600 });
      const result = await runRealLoadTest('run-3', config, ac, () => {});

      expect(Object.keys(result.pageMetrics).length).toBeGreaterThanOrEqual(1);
      for (const path of Object.keys(result.pageMetrics)) {
        expect(['/a', '/b', '/c']).toContain(path);
        expect(result.pageMetrics[path].count).toBeGreaterThan(0);
        expect(result.pageMetrics[path].errors).toBe(0);
        expect(result.pageMetrics[path].avgMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('defaults to "/" when paths array is empty', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest('run-4', buildConfig({ paths: [] }), ac, () => {});

      expect(result.totalRequests).toBeGreaterThan(0);
      expect(result.pageMetrics['/']?.count ?? 0).toBeGreaterThan(0);
    });

    it('handles a single user without divide-by-zero in ramp-up', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest('run-5', buildConfig({ userCount: 1 }), ac, () => {});

      expect(result.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('error classification', () => {
    it('classifies 4xx responses as http_4xx errors', async () => {
      globalThis.fetch = makeFetchMock({ status: 404 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-6',
        buildConfig({ autoStopErrorThreshold: 200 }), // never auto-stop
        ac,
        () => {},
      );

      expect(result.failed).toBe(result.totalRequests);
      expect(result.completed).toBe(0);
      expect(result.errorBreakdown.http_4xx).toBe(result.totalRequests);
      expect(result.errorRate).toBe(100);
    });

    it('classifies 5xx responses as http_5xx errors', async () => {
      globalThis.fetch = makeFetchMock({ status: 503 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-7',
        buildConfig({ autoStopErrorThreshold: 200 }),
        ac,
        () => {},
      );

      expect(result.errorBreakdown.http_5xx).toBe(result.totalRequests);
    });

    it('classifies thrown fetch errors as network errors', async () => {
      globalThis.fetch = makeFetchMock({
        throwError: new TypeError('connection refused'),
      }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-8',
        buildConfig({ autoStopErrorThreshold: 200 }),
        ac,
        () => {},
      );

      expect(result.errorBreakdown.network).toBe(result.totalRequests);
    });

    it('classifies aborted fetches as timeout errors', async () => {
      globalThis.fetch = makeFetchMock({ hang: true }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-9',
        buildConfig({
          userCount: 1,
          durationMs: 600,
          timeoutMs: 200, // short timeout so test is fast
          autoStopErrorThreshold: 200,
        }),
        ac,
        () => {},
      );

      expect(result.errorBreakdown.timeout ?? 0).toBeGreaterThan(0);
    });
  });

  describe('auto-stop', () => {
    it('aborts the run when error rate exceeds threshold after ≥20 samples', async () => {
      globalThis.fetch = makeFetchMock({ status: 500 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();
      const onMetrics = vi.fn<(m: LiveMetrics) => void>();

      const start = Date.now();
      const result = await runRealLoadTest(
        'run-10',
        buildConfig({
          userCount: 5,
          durationMs: 10_000, // would run for 10s, but auto-stop should kill it earlier
          autoStopErrorThreshold: 50,
        }),
        ac,
        onMetrics,
      );
      const elapsed = Date.now() - start;

      // Auto-stop fires after 20+ samples; with 5 users x ~3-5 requests/sec, this should trigger fast.
      expect(elapsed).toBeLessThan(5_000);
      expect(ac.signal.aborted).toBe(true);
      expect(result.totalRequests).toBeGreaterThanOrEqual(20);
      expect(result.failed).toBeGreaterThan(0);
    });

    it('does NOT auto-stop when error rate is below threshold', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-11',
        buildConfig({ durationMs: 400, autoStopErrorThreshold: 50 }),
        ac,
        () => {},
      );

      expect(ac.signal.aborted).toBe(false);
      expect(result.errorRate).toBe(0);
    });
  });

  describe('external abort', () => {
    it('terminates all users when the abort controller fires externally', async () => {
      globalThis.fetch = makeFetchMock({
        status: 200,
        latencyMs: 50,
      }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const start = Date.now();
      const promise = runRealLoadTest(
        'run-12',
        buildConfig({ userCount: 3, durationMs: 5_000 }),
        ac,
        () => {},
      );

      // Abort after a short delay
      setTimeout(() => ac.abort(), 250);
      const result = await promise;
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2_000);
      expect(ac.signal.aborted).toBe(true);
      // Some requests may have completed before abort
      expect(result.totalRequests).toBeGreaterThanOrEqual(0);
    });

    it('cleanly aborts users still in ramp-up delay', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const start = Date.now();
      const promise = runRealLoadTest(
        'run-13',
        buildConfig({
          userCount: 5,
          durationMs: 5_000,
          rampUpMs: 4_000, // most users still ramping up when we abort
        }),
        ac,
        () => {},
      );

      setTimeout(() => ac.abort(), 200);
      await promise;
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2_000);
    });
  });

  describe('live metrics callback', () => {
    it('invokes onMetrics with valid LiveMetrics shape during the run', async () => {
      globalThis.fetch = makeFetchMock({
        status: 200,
        latencyMs: 30,
      }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();
      const calls: LiveMetrics[] = [];

      await runRealLoadTest('run-14', buildConfig({ userCount: 3, durationMs: 1_500 }), ac, (m) =>
        calls.push(m),
      );

      // The metrics loop runs every 500ms; expect at least one call
      expect(calls.length).toBeGreaterThan(0);
      const m = calls[0];
      expect(m).toMatchObject({
        completed: expect.any(Number),
        failed: expect.any(Number),
        totalRequests: expect.any(Number),
        errorRate: expect.any(Number),
        avgResponseMs: expect.any(Number),
        requestsPerSec: expect.any(Number),
        elapsedMs: expect.any(Number),
        activeUsers: expect.any(Number),
        status: 'running',
        pageMetrics: expect.any(Object),
        errorBreakdown: expect.any(Object),
        resourceStats: {
          cpu: expect.any(Number),
          ram: expect.any(Number),
          dbConnections: expect.any(Number),
        },
        chartPoint: {
          time: expect.any(String),
          value: expect.any(Number),
        },
        activityBatch: expect.any(Array),
      });
    });

    it('emits activityBatch entries with success/error type classification', async () => {
      globalThis.fetch = makeFetchMock({ status: 500 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();
      const calls: LiveMetrics[] = [];

      await runRealLoadTest(
        'run-15',
        buildConfig({
          userCount: 2,
          durationMs: 800,
          autoStopErrorThreshold: 200, // never auto-stop
        }),
        ac,
        (m) => calls.push(m),
      );

      const allActivity = calls.flatMap((c) => c.activityBatch);
      expect(allActivity.length).toBeGreaterThan(0);
      // All should be classified as 'error' since every response was 500
      expect(allActivity.every((a) => a.type === 'error')).toBe(true);
      expect(allActivity[0].action).toMatch(/→ 500/);
    });
  });

  describe('multi-path round-robin', () => {
    it('distributes requests across multiple paths', async () => {
      globalThis.fetch = makeFetchMock({ status: 200 }) as unknown as typeof globalThis.fetch;
      const ac = new AbortController();

      const result = await runRealLoadTest(
        'run-16',
        buildConfig({ paths: ['/x', '/y', '/z'], userCount: 3, durationMs: 800 }),
        ac,
        () => {},
      );

      const pathsHit = Object.keys(result.pageMetrics);
      expect(pathsHit.length).toBeGreaterThanOrEqual(2);
      for (const p of pathsHit) {
        expect(['/x', '/y', '/z']).toContain(p);
      }
    });
  });
});
