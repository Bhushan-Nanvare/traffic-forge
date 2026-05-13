/**
 * Pino logger setup with correlation IDs.
 *
 * Every HTTP request gets a stable correlation ID that:
 *  - Honors an inbound `x-correlation-id` header (distributed tracing flow)
 *  - Falls back to a fresh UUID if the header is missing
 *  - Is echoed in the response so clients can include it in bug reports
 *  - Is attached as `req.id` and `req.log` (child logger) for use in handlers
 *
 * Background async work (AI analysis, load tests) creates child loggers
 * tagged with the runId so all logs for that run can be filtered together.
 */
import pino from 'pino';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]',
    // Anthropic API keys can show up in error messages
    '*.apiKey',
    '*.ANTHROPIC_API_KEY',
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }),
});

/**
 * Generate a correlation ID. Honors inbound `x-correlation-id` (case-insensitive)
 * for distributed tracing, otherwise generates a fresh UUID.
 *
 * Pino-http calls this with (req, res) on every request. The returned ID is
 * attached as req.id and threaded into req.log via the per-request child logger.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const headerValue = req.headers['x-correlation-id'];
  const incoming =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0]
        : undefined;

  // Reject obviously bad inbound IDs (too long, control chars) — fresh UUID instead
  const id =
    incoming && incoming.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(incoming)
      ? incoming
      : randomUUID();

  // Echo the chosen ID so the client can correlate
  res.setHeader('x-correlation-id', id);
  return id;
}

/**
 * Build a child logger tagged with run-level fields. Use for background work
 * that doesn't have a request context (analysis pipeline, load tests).
 */
export function runLogger(runId: string, extra: Record<string, unknown> = {}) {
  return logger.child({ runId, ...extra });
}
