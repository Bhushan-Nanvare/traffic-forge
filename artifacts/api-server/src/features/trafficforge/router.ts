import { Router, type Request, type Response, type RequestHandler } from "express";
import { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@workspace/db";
import { testConfigsTable, testRunsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger as rootLogger } from "../../shared/lib/logger";
import { scanUrl } from "./engine/scanner.js";
import { runRealLoadTest, type LiveMetrics } from "./engine/loadEngine.js";
import { runBrowserLoadTest, type BrowserLiveMetrics } from "./engine/browserEngine.js";

const router = Router();

// ─── In-memory state ─────────────────────────────────────────────────────────

const activeRuns = new Map<string, { abortController: AbortController; startedAt: number; config: Record<string, unknown> }>();
const runClients = new Map<string, Set<WebSocket>>();

function broadcastToRun(runId: string, payload: unknown) {
  const clients = runClients.get(runId);
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function setupWebSocketServer(wss: WebSocketServer) {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const runId = url.searchParams.get("runId") ?? "__global__";

    if (!runClients.has(runId)) runClients.set(runId, new Set());
    runClients.get(runId)!.add(ws);

    rootLogger.info({ runId }, "WebSocket client connected");

    ws.on("close", () => {
      runClients.get(runId)?.delete(ws);
      if (runClients.get(runId)?.size === 0) runClients.delete(runId);
    });
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "trafficforge-backend" });
});

// ─── Active Runs ──────────────────────────────────────────────────────────────

router.get("/active-runs", (_req: Request, res: Response) => {
  const runs = Array.from(activeRuns.entries()).map(([id, data]) => ({
    id,
    startedAt: data.startedAt,
    config: { url: (data.config as Record<string, unknown>).url },
  }));
  return res.json(runs);
});

// ─── Real URL Scanner ─────────────────────────────────────────────────────────

const scan: RequestHandler = async (req, res) => {
  const { url, maxPages = 20 } = req.body ?? {};

  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    new URL(url as string);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    const result = await scanUrl(url as string, Math.min(Number(maxPages), 30));
    if (result.error) {
      return res.status(502).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Scanner error");
    return res.status(500).json({ error: "Failed to scan URL" });
  }
};
router.post("/scan", scan);

// ─── Test Configs ─────────────────────────────────────────────────────────────

const createTestConfig: RequestHandler = async (req, res) => {
  const {
    url, user_count, duration_sec, ramp_up_sec,
    app_type, persona, shadow_mode, respect_rate_limits,
    auto_stop_error_threshold, discovered_paths,
    test_mode, browser_user_count, browser_duration_sec, browser_ramp_up_sec,
    login_username, login_password,
  } = req.body ?? {};

  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const [row] = await db
      .insert(testConfigsTable)
      .values({
        url: url as string,
        user_count: (user_count as number) ?? 10,
        duration_sec: (duration_sec as number) ?? 60,
        ramp_up_sec: (ramp_up_sec as number) ?? 10,
        app_type: (app_type as string) ?? null,
        persona: (persona as string) ?? null,
        shadow_mode: (shadow_mode as boolean) ?? false,
        respect_rate_limits: (respect_rate_limits as boolean) ?? true,
        auto_stop_error_threshold: (auto_stop_error_threshold as number) ?? 10,
        discovered_paths: (discovered_paths as string[]) ?? null,
        test_mode: (test_mode as string) ?? "http",
        browser_user_count: (browser_user_count as number) ?? 3,
        browser_duration_sec: (browser_duration_sec as number) ?? 60,
        browser_ramp_up_sec: (browser_ramp_up_sec as number) ?? 5,
        login_username: (login_username as string) ?? null,
        login_password: (login_password as string) ?? null,
      })
      .returning();

    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create test config");
    return res.status(500).json({ error: "Failed to create test config" });
  }
};
router.post("/test-configs", createTestConfig);

// ─── Test Runs ────────────────────────────────────────────────────────────────

const createTestRun: RequestHandler = async (req, res) => {
  const { config_id, status = "pending" } = req.body ?? {};
  const id = randomUUID();

  try {
    const [row] = await db
      .insert(testRunsTable)
      .values({ id, config_id: (config_id as number) ?? null, status: status as string })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create test run");
    return res.status(500).json({ error: "Failed to create test run" });
  }
};
router.post("/test-runs", createTestRun);

const listTestRuns: RequestHandler = async (req, res) => {
  try {
    const runs = await db.select().from(testRunsTable).orderBy(desc(testRunsTable.created_at)).limit(50);
    return res.json(runs);
  } catch (err) {
    req.log.error({ err }, "Failed to list test runs");
    return res.status(500).json({ error: "Failed to list test runs" });
  }
};
router.get("/test-runs", listTestRuns);

const getTestRun: RequestHandler<{ id: string }> = async (req, res) => {
  const id = req.params.id;
  try {
    const [run] = await db.select().from(testRunsTable).where(eq(testRunsTable.id, id)).limit(1);
    if (!run) return res.status(404).json({ error: "Test run not found" });
    return res.json(run);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch test run");
    return res.status(500).json({ error: "Failed to fetch test run" });
  }
};
router.get("/test-runs/:id", getTestRun);

const startTestRun: RequestHandler<{ id: string }> = async (req, res) => {
  const id = req.params.id;
  const { config: overrideConfig } = req.body ?? {};

  if (activeRuns.has(id)) return res.status(400).json({ error: "Test run already active", id });

  let config = overrideConfig as Record<string, unknown> | undefined;
  if (!config?.url) {
    const [run] = await db.select().from(testRunsTable).where(eq(testRunsTable.id, id)).limit(1);
    if (run?.config_id) {
      const [cfg] = await db.select().from(testConfigsTable).where(eq(testConfigsTable.id, run.config_id)).limit(1);
      config = cfg as Record<string, unknown>;
    }
  }

  if (!config?.url) return res.status(400).json({ error: "No url found in config", id });

  await db.update(testRunsTable).set({ status: "running", started_at: new Date() }).where(eq(testRunsTable.id, id));

  const abortController = new AbortController();
  activeRuns.set(id, { abortController, startedAt: Date.now(), config });

  runRealLoadTestSession(id, config, abortController).finally(() => {
    activeRuns.delete(id);
  });

  return res.json({ id, status: "running", message: "Real load test started" });
};
router.post("/test-runs/:id/start", startTestRun);

const stopTestRun: RequestHandler<{ id: string }> = (req, res) => {
  const id = req.params.id;
  const run = activeRuns.get(id);
  if (!run) return res.status(404).json({ error: "No active run found", id });

  run.abortController.abort();
  activeRuns.delete(id);
  return res.json({ id, status: "stopped", message: "Test run aborted" });
};
router.post("/test-runs/:id/stop", stopTestRun);

const cleanupTestRun: RequestHandler<{ id: string }> = async (req, res) => {
  const id = req.params.id;
  const run = activeRuns.get(id);
  if (run) { run.abortController.abort(); activeRuns.delete(id); }

  try {
    const [runRow] = await db.select().from(testRunsTable).where(eq(testRunsTable.id, id)).limit(1);
    await db.delete(testRunsTable).where(eq(testRunsTable.id, id));
    if (runRow?.config_id) {
      await db.delete(testConfigsTable).where(eq(testConfigsTable.id, runRow.config_id)).catch(() => {});
    }
    return res.json({ id, message: "Cleaned up", cleaned: true });
  } catch (err) {
    req.log.error({ err }, "Failed to cleanup test run");
    return res.status(500).json({ error: "Failed to cleanup" });
  }
};
router.post("/test-runs/:id/cleanup", cleanupTestRun);

// ─── Real Load Test Session ───────────────────────────────────────────────────

async function runRealLoadTestSession(
  runId: string,
  config: Record<string, unknown>,
  abortController: AbortController,
) {
  const testMode = (config.test_mode as string) ?? "http";
  const autoStopThreshold = Number(config.auto_stop_error_threshold ?? 10);

  // Shared HTTP config
  const userCount = Number(config.user_count ?? 10);
  const durationSec = Number(config.duration_sec ?? 60);
  const rampUpSec = Number(config.ramp_up_sec ?? 10);
  const respectRateLimits = Boolean(config.respect_rate_limits ?? true);
  const storedPaths = (config.discovered_paths as string[] | undefined) ?? [];
  const paths = storedPaths.length > 0 ? storedPaths : ["/"];

  // Browser config
  const browserUserCount = Number(config.browser_user_count ?? 3);
  const browserDurationSec = Number(config.browser_duration_sec ?? 60);
  const browserRampUpSec = Number(config.browser_ramp_up_sec ?? 5);

  let mergedPageMetrics: Record<string, { count: number; avgMs: number; errors: number }> = {};
  let mergedErrorBreakdown: Record<string, number> = {};
  let totalCompleted = 0, totalFailed = 0, totalRequests = 0;
  let avgResponseMs = 0, p50Ms = 0, p95Ms = 0, p99Ms = 0, errorRate = 0;

  const runHttp = async () => {
    const loadConfig = {
      url: config.url as string,
      paths,
      userCount,
      durationMs: durationSec * 1000,
      rampUpMs: rampUpSec * 1000,
      respectRateLimits,
      autoStopErrorThreshold: autoStopThreshold,
      timeoutMs: 15000,
    };

    const onMetrics = (metrics: LiveMetrics) => {
      broadcastToRun(runId, {
        type: "metrics",
        runId,
        stats: {
          activeAgents: metrics.activeUsers,
          requestsPerSec: metrics.requestsPerSec,
          errorRate: metrics.errorRate,
          avgResponseTime: metrics.avgResponseMs,
        },
        resourceStats: metrics.resourceStats,
        chartPoint: metrics.chartPoint,
        activity: metrics.activityBatch,
        enriched: {
          completed: metrics.completed,
          failed: metrics.failed,
          elapsedMs: metrics.elapsedMs,
          status: metrics.status,
          p50Ms: metrics.p50Ms,
          p95Ms: metrics.p95Ms,
          p99Ms: metrics.p99Ms,
          deviceCounts: null,
          pageVisits: metrics.pageVisits,
          journeyNames: null,
          errorsByType: metrics.errorsByType,
          pageMetrics: metrics.pageMetrics,
          engineType: "http",
        },
      });
    };

    try {
      const stats = await runRealLoadTest(runId, loadConfig, abortController, onMetrics);
      totalCompleted += stats.completed;
      totalFailed += stats.failed;
      totalRequests += stats.totalRequests;
      avgResponseMs = stats.avgResponseMs;
      p50Ms = stats.p50Ms;
      p95Ms = stats.p95Ms;
      p99Ms = stats.p99Ms;
      errorRate = stats.errorRate;
      for (const [k, v] of Object.entries(stats.pageMetrics)) {
        mergedPageMetrics[k] = v;
      }
      for (const [k, v] of Object.entries(stats.errorBreakdown)) {
        mergedErrorBreakdown[k] = (mergedErrorBreakdown[k] ?? 0) + v;
      }
    } catch (err) {
      rootLogger.error({ err, runId }, "HTTP load test engine error");
    }
  };

  const runBrowser = async () => {
    const browserConfig = {
      url: config.url as string,
      appType: (config.app_type as string) ?? "generic",
      userCount: browserUserCount,
      durationMs: browserDurationSec * 1000,
      rampUpMs: browserRampUpSec * 1000,
      loginUsername: (config.login_username as string) ?? undefined,
      loginPassword: (config.login_password as string) ?? undefined,
      discoveredPaths: paths,
    };

    const onBrowserMetrics = (metrics: BrowserLiveMetrics) => {
      broadcastToRun(runId, {
        type: "metrics",
        runId,
        stats: {
          activeAgents: metrics.activeUsers,
          requestsPerSec: 0,
          errorRate: metrics.completed + metrics.failed > 0
            ? Math.round((metrics.failed / (metrics.completed + metrics.failed)) * 100)
            : 0,
          avgResponseTime: metrics.avgDurationMs,
        },
        activity: metrics.activityBatch,
        enriched: {
          completed: metrics.completed,
          failed: metrics.failed,
          elapsedMs: 0,
          status: "running",
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          pageVisits: Object.fromEntries(
            Object.entries(metrics.pageMetrics).map(([k, v]) => [k, v.count])
          ),
          errorsByType: metrics.errorsByType,
          pageMetrics: metrics.pageMetrics,
          engineType: "browser",
        },
      });
    };

    try {
      const stats = await runBrowserLoadTest(runId, browserConfig, abortController, onBrowserMetrics);
      totalCompleted += stats.completed;
      totalFailed += stats.failed;
      totalRequests += stats.completed + stats.failed;
      const avgMs = stats.avgDurationMs;
      if (avgResponseMs === 0) {
        avgResponseMs = avgMs;
      } else {
        avgResponseMs = Math.round((avgResponseMs + avgMs) / 2);
      }
      for (const [k, v] of Object.entries(stats.pageMetrics)) {
        if (mergedPageMetrics[k]) {
          mergedPageMetrics[k].count += v.count;
          mergedPageMetrics[k].errors += v.errors;
        } else {
          mergedPageMetrics[k] = v;
        }
      }
      for (const [k, v] of Object.entries(stats.errorsByType)) {
        mergedErrorBreakdown[k] = (mergedErrorBreakdown[k] ?? 0) + v;
      }
    } catch (err) {
      rootLogger.error({ err, runId }, "Browser load test engine error");
    }
  };

  if (testMode === "http") {
    await runHttp();
  } else if (testMode === "browser") {
    await runBrowser();
  } else {
    // "both" — run concurrently
    await Promise.allSettled([runHttp(), runBrowser()]);
  }

  if (totalRequests > 0) {
    errorRate = Math.round((totalFailed / totalRequests) * 100 * 10) / 10;
  }

  const finalStatus = abortController.signal.aborted ? "cancelled" : "completed";
  const passed = errorRate < autoStopThreshold;

  await db.update(testRunsTable).set({
    status: finalStatus,
    ended_at: new Date(),
    total_requests: totalRequests,
    error_rate: errorRate,
    avg_response_ms: avgResponseMs,
    p50_ms: p50Ms,
    p95_ms: p95Ms,
    p99_ms: p99Ms,
    passed,
    user_count: testMode === "browser" ? browserUserCount : testMode === "both" ? userCount + browserUserCount : userCount,
    page_metrics: mergedPageMetrics,
    error_breakdown: mergedErrorBreakdown,
  }).where(eq(testRunsTable.id, runId));

  broadcastToRun(runId, {
    type: "metrics",
    runId,
    stats: {
      activeAgents: 0,
      requestsPerSec: 0,
      errorRate,
      avgResponseTime: avgResponseMs,
    },
    enriched: {
      completed: totalCompleted,
      failed: totalFailed,
      elapsedMs: 0,
      status: finalStatus,
      p50Ms,
      p95Ms,
      p99Ms,
      pageVisits: Object.fromEntries(
        Object.entries(mergedPageMetrics).map(([k, v]) => [k, v.count])
      ),
      errorsByType: mergedErrorBreakdown,
      pageMetrics: mergedPageMetrics,
    },
  });
}

export default router;
