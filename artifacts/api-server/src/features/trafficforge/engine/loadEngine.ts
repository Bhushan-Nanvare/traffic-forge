/**
 * Real Load Testing Engine — fires actual HTTP requests to the target URL.
 * Measures real response times, status codes, and errors. No simulation.
 */
import os from "os";

export interface LoadConfig {
  url: string;
  paths: string[];
  userCount: number;
  durationMs: number;
  rampUpMs: number;
  respectRateLimits: boolean;
  autoStopErrorThreshold: number;
  timeoutMs?: number;
}

export interface RequestResult {
  path: string;
  statusCode: number;
  responseMs: number;
  success: boolean;
  errorType?: "timeout" | "network" | "http_4xx" | "http_5xx";
  timestamp: number;
  userId: number;
}

export interface LiveMetrics {
  completed: number;
  failed: number;
  totalRequests: number;
  errorRate: number;
  avgResponseMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requestsPerSec: number;
  elapsedMs: number;
  activeUsers: number;
  status: string;
  pageMetrics: Record<string, { count: number; avgMs: number; errors: number }>;
  errorBreakdown: Record<string, number>;
  pageVisits: Record<string, number>;
  errorsByType: Record<string, number>;
  resourceStats: { cpu: number; ram: number; dbConnections: number };
  chartPoint: { time: string; value: number };
  activityBatch: Array<{
    id: number;
    name: string;
    action: string;
    type: "info" | "success" | "error";
    time: string;
  }>;
}

const USER_AGENT = "TrafficForge-LoadTest/1.0 (Real HTTP Load Tester)";
let globalActivityId = 0;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getCpuPercent(): number {
  // Estimate CPU usage using loadavg vs number of CPUs
  const load = os.loadavg()[0]; // 1-minute load average
  const cpus = os.cpus().length;
  return Math.min(100, Math.round((load / cpus) * 100));
}

function getRamMb(): number {
  const used = process.memoryUsage();
  return Math.round((used.heapUsed + used.external) / 1024 / 1024);
}

async function makeRequest(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  userId: number
): Promise<RequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();
  const timestamp = Date.now();

  const fullUrl = `${baseUrl.replace(/\/$/, "")}${path}`;

  try {
    const res = await fetch(fullUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "X-Load-Test": "TrafficForge",
      },
      redirect: "follow",
    });
    // Drain the body to get accurate time-to-complete (not just TTFB)
    await res.text().catch(() => {});
    const responseMs = Math.round(performance.now() - t0);

    if (res.status >= 500) {
      return { path, statusCode: res.status, responseMs, success: false, errorType: "http_5xx", timestamp, userId };
    }
    if (res.status >= 400) {
      return { path, statusCode: res.status, responseMs, success: false, errorType: "http_4xx", timestamp, userId };
    }
    return { path, statusCode: res.status, responseMs, success: true, timestamp, userId };
  } catch (err: unknown) {
    const responseMs = Math.round(performance.now() - t0);
    const isAborted = err instanceof Error && err.name === "AbortError";
    return {
      path,
      statusCode: 0,
      responseMs,
      success: false,
      errorType: isAborted ? "timeout" : "network",
      timestamp,
      userId,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildMetrics(
  results: RequestResult[],
  activeUsers: number,
  startTime: number,
  recentBatch: RequestResult[],
  inFlightCount: number
): LiveMetrics {
  const elapsedMs = Date.now() - startTime;
  const elapsedSec = elapsedMs / 1000;

  const completed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;
  const errorRate = total === 0 ? 0 : +((failed / total) * 100).toFixed(2);

  const successTimes = results.filter(r => r.success).map(r => r.responseMs).sort((a, b) => a - b);
  const avgResponseMs = successTimes.length === 0 ? 0 : Math.round(successTimes.reduce((s, v) => s + v, 0) / successTimes.length);

  // Per-path metrics
  const pageMetrics: Record<string, { count: number; avgMs: number; errors: number }> = {};
  for (const r of results) {
    if (!pageMetrics[r.path]) pageMetrics[r.path] = { count: 0, avgMs: 0, errors: 0 };
    pageMetrics[r.path].count++;
    if (!r.success) {
      pageMetrics[r.path].errors++;
    } else {
      const pm = pageMetrics[r.path];
      const successCount = pm.count - pm.errors;
      pm.avgMs = Math.round((pm.avgMs * (successCount - 1) + r.responseMs) / successCount);
    }
  }

  // Error breakdown
  const errorBreakdown: Record<string, number> = {};
  for (const r of results.filter(r => !r.success)) {
    const key = r.errorType ?? "unknown";
    errorBreakdown[key] = (errorBreakdown[key] ?? 0) + 1;
  }

  // Page visits (count of requests per path, successful + failed)
  const pageVisits: Record<string, number> = {};
  for (const [path, pm] of Object.entries(pageMetrics)) {
    pageVisits[path] = pm.count;
  }

  const now = new Date();
  const chartPoint = {
    time: `${now.getMinutes()}:${String(now.getSeconds()).padStart(2, "0")}`,
    value: avgResponseMs || 0,
  };

  // Build activity feed from recent batch
  const activityBatch = recentBatch.map(r => {
    const id = ++globalActivityId;
    const statusLabel = r.statusCode > 0 ? `${r.statusCode}` : r.errorType ?? "ERR";
    const action = `${r.path} → ${statusLabel} (${r.responseMs}ms)`;
    const type: "success" | "error" | "info" = !r.success ? "error" : r.responseMs > 2000 ? "info" : "success";
    return {
      id,
      name: `User-${r.userId}`,
      action,
      type,
      time: new Date(r.timestamp).toLocaleTimeString(),
    };
  });

  return {
    completed,
    failed,
    totalRequests: total,
    errorRate,
    avgResponseMs,
    p50Ms: percentile(successTimes, 50),
    p95Ms: percentile(successTimes, 95),
    p99Ms: percentile(successTimes, 99),
    requestsPerSec: elapsedSec > 0 ? +(total / elapsedSec).toFixed(1) : 0,
    elapsedMs,
    activeUsers,
    status: "running",
    pageMetrics,
    errorBreakdown,
    pageVisits,
    errorsByType: errorBreakdown,
    resourceStats: {
      cpu: getCpuPercent(),
      ram: getRamMb(),
      dbConnections: inFlightCount,
    },
    chartPoint,
    activityBatch,
  };
}

export async function runRealLoadTest(
  _runId: string,
  config: LoadConfig,
  abortController: AbortController,
  onMetrics: (metrics: LiveMetrics) => void
): Promise<{
  completed: number;
  failed: number;
  totalRequests: number;
  avgResponseMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  pageMetrics: Record<string, { count: number; avgMs: number; errors: number }>;
  errorBreakdown: Record<string, number>;
}> {
  const {
    url,
    paths,
    userCount,
    durationMs,
    rampUpMs,
    respectRateLimits,
    autoStopErrorThreshold,
    timeoutMs = 15000,
  } = config;

  const safePaths = paths.length > 0 ? paths : ["/"];
  const signal = abortController.signal;
  const startTime = Date.now();

  const allResults: RequestResult[] = [];
  let activeUsers = 0;
  let inFlightCount = 0;
  let recentBatch: RequestResult[] = [];
  let autoStopped = false;

  // Ramp-up: each user starts at an evenly spaced interval
  const rampInterval = userCount > 1 ? rampUpMs / (userCount - 1) : 0;

  const userPromises: Promise<void>[] = [];

  for (let i = 0; i < userCount; i++) {
    const userId = i + 1;
    const delay = Math.round(i * rampInterval);

    userPromises.push(
      (async () => {
        // Wait for ramp-up delay
        await new Promise<void>(r => {
          const t = setTimeout(r, delay);
          signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
        });
        if (signal.aborted) return;

        activeUsers++;
        let pathIdx = Math.floor(Math.random() * safePaths.length);

        while (!signal.aborted && Date.now() - startTime < durationMs) {
          const path = safePaths[pathIdx % safePaths.length];
          pathIdx++;

          inFlightCount++;
          const result = await makeRequest(url, path, timeoutMs, userId);
          inFlightCount--;

          allResults.push(result);
          recentBatch.push(result);

          // Check auto-stop
          if (!autoStopped && allResults.length >= 20) {
            const failCount = allResults.filter(r => !r.success).length;
            const errPct = (failCount / allResults.length) * 100;
            if (errPct > autoStopErrorThreshold) {
              autoStopped = true;
              abortController.abort();
              break;
            }
          }

          if (signal.aborted) break;

          // Think time between requests
          const thinkTime = respectRateLimits
            ? 800 + Math.random() * 1200    // 0.8–2s for polite mode
            : 50 + Math.random() * 200;     // 50–250ms for aggressive mode

          await new Promise<void>(r => {
            const t = setTimeout(r, thinkTime);
            signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
          });
        }

        activeUsers--;
      })()
    );
  }

  // Metrics broadcast loop every 500ms
  const metricsLoop = setInterval(() => {
    if (allResults.length === 0 && activeUsers === 0) return;
    const batch = recentBatch.splice(0, recentBatch.length); // drain batch
    const metrics = buildMetrics(allResults, activeUsers, startTime, batch, inFlightCount);
    onMetrics(metrics);
  }, 500);

  await Promise.allSettled(userPromises);
  clearInterval(metricsLoop);

  // Final metrics snapshot
  const finalResults = allResults;
  const completed = finalResults.filter(r => r.success).length;
  const failed = finalResults.filter(r => !r.success).length;
  const total = finalResults.length;
  const errorRate = total === 0 ? 0 : +((failed / total) * 100).toFixed(2);
  const successTimes = finalResults.filter(r => r.success).map(r => r.responseMs).sort((a, b) => a - b);
  const avgResponseMs = successTimes.length === 0 ? 0 : Math.round(successTimes.reduce((s, v) => s + v, 0) / successTimes.length);

  const pageMetrics: Record<string, { count: number; avgMs: number; errors: number }> = {};
  for (const r of finalResults) {
    if (!pageMetrics[r.path]) pageMetrics[r.path] = { count: 0, avgMs: 0, errors: 0 };
    pageMetrics[r.path].count++;
    if (!r.success) {
      pageMetrics[r.path].errors++;
    } else {
      const pm = pageMetrics[r.path];
      const sc = pm.count - pm.errors;
      pm.avgMs = Math.round((pm.avgMs * (sc - 1) + r.responseMs) / sc);
    }
  }

  const errorBreakdown: Record<string, number> = {};
  for (const r of finalResults.filter(r => !r.success)) {
    const key = r.errorType ?? "unknown";
    errorBreakdown[key] = (errorBreakdown[key] ?? 0) + 1;
  }

  return {
    completed,
    failed,
    totalRequests: total,
    avgResponseMs,
    p50Ms: percentile(successTimes, 50),
    p95Ms: percentile(successTimes, 95),
    p99Ms: percentile(successTimes, 99),
    errorRate,
    pageMetrics,
    errorBreakdown,
  };
}
