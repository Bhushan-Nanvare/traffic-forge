import http from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./shared/lib/logger";
import { setupWebSocketServer } from "./features/trafficforge/router";
import { db } from "@workspace/db";
import { testRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });
setupWebSocketServer(wss);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/ws/live-metrics") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

async function start() {
  // On startup, sweep for any runs stuck in "running" state from a previous
  // server instance (crash or restart). Mark them as "interrupted" so the UI
  // doesn't show them as permanently active.
  try {
    const result = await db
      .update(testRunsTable)
      .set({ status: "interrupted", ended_at: new Date() })
      .where(eq(testRunsTable.status, "running"))
      .returning({ id: testRunsTable.id });

    if (result.length > 0) {
      logger.warn(
        { count: result.length, ids: result.map((r) => r.id) },
        "Marked stale running test runs as interrupted on startup",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to sweep stale running runs on startup");
  }

  server.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start();
