/**
 * Demo Chat App Server — intentional bugs for TrafficForge to detect.
 *
 * Persistence: SQLite (better-sqlite3) — survives restarts.
 * Bug toggles: every bug is gated behind an env-var flag (default ON for the demo).
 *   ENABLE_BUG_ORDER_VIOLATION       — timestamp jitter + insertion-order GET
 *   ENABLE_BUG_PERSISTENCE_FAILURE   — random write rejections under load
 *   ENABLE_BUG_REALTIME_DELAY        — broadcast delayed 2-4s
 *   ENABLE_BUG_REACTION_RACE         — read-modify-write race on reactions
 *   ENABLE_BUG_BROADCAST_DROP        — 15% of broadcasts silently dropped
 *
 * Set any of these to "false" to disable the corresponding bug. Useful for
 * proving each bug exists in isolation, or for clean-baseline comparisons.
 */
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';

// ─── Bug toggles ──────────────────────────────────────────────────────────────

const isOn = (flag: string | undefined): boolean => flag !== 'false' && flag !== '0';

const BUGS = {
  orderViolation: isOn(process.env['ENABLE_BUG_ORDER_VIOLATION']),
  persistenceFailure: isOn(process.env['ENABLE_BUG_PERSISTENCE_FAILURE']),
  realtimeDelay: isOn(process.env['ENABLE_BUG_REALTIME_DELAY']),
  reactionRace: isOn(process.env['ENABLE_BUG_REACTION_RACE']),
  broadcastDrop: isOn(process.env['ENABLE_BUG_BROADCAST_DROP']),
};

// ─── SQLite persistence ───────────────────────────────────────────────────────

const DB_PATH = process.env['DB_PATH'] ?? path.join(process.cwd(), 'demo-chat.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    server_seq INTEGER NOT NULL,
    reactions TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_seq ON messages(server_seq);
  CREATE TABLE IF NOT EXISTS sequence (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO sequence(name, value) VALUES('messages', 0);
`);

interface MessageRow {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  server_seq: number;
  reactions: string;
  created_at: number;
}

const insertMessage = db.prepare<[string, string, string, number, number, string, number]>(
  'INSERT INTO messages(id, user, text, timestamp, server_seq, reactions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
);
const incrementSeq = db.prepare<[string]>('UPDATE sequence SET value = value + 1 WHERE name = ?');
const getSeq = db.prepare<[string]>('SELECT value FROM sequence WHERE name = ?');
// BUG #1: ORDER BY timestamp lets jitter reorder rows; the bug-free version would ORDER BY server_seq.
const selectAllUnsorted = db.prepare('SELECT * FROM messages ORDER BY timestamp ASC');
const selectAllSorted = db.prepare('SELECT * FROM messages ORDER BY server_seq ASC');
const selectById = db.prepare<[string]>('SELECT * FROM messages WHERE id = ?');
const updateReactions = db.prepare<[string, string]>(
  'UPDATE messages SET reactions = ? WHERE id = ?',
);
const deleteAll = db.prepare('DELETE FROM messages');

const allocSeq = db.transaction(() => {
  incrementSeq.run('messages');
  return (getSeq.get('messages') as { value: number }).value;
});

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  reactions: Record<string, number>;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    user: row.user,
    text: row.text,
    timestamp: row.timestamp,
    reactions: JSON.parse(row.reactions),
  };
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const subscribers = new Set<WebSocket>();
let lastWriteMs = 0;

app.get('/health', (_req: Request, res: Response) => {
  const count = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as { n: number }).n;
  res.json({ status: 'ok', messageCount: count, bugs: BUGS });
});

app.get('/messages', (_req: Request, res: Response) => {
  const stmt = BUGS.orderViolation ? selectAllUnsorted : selectAllSorted;
  const rows = stmt.all() as MessageRow[];
  res.json(rows.map(rowToMessage));
});

app.post('/messages', (req: Request, res: Response) => {
  const { user, text } = req.body as { user?: string; text?: string };
  if (!user || !text) return res.status(400).json({ error: 'user and text required' });

  const now = Date.now();

  // BUG #2 (toggleable): persistence failure under burst writes
  if (BUGS.persistenceFailure && now - lastWriteMs < 300 && Math.random() < 0.3) {
    return res.status(503).json({ error: 'Server busy — write dropped (intentional bug)' });
  }
  lastWriteMs = now;

  // BUG #1 companion: timestamp jitter (insertion order != displayed order)
  const timestamp = BUGS.orderViolation ? now + Math.floor(Math.random() * 200 - 100) : now;

  const message: Message = {
    id: randomUUID(),
    user,
    text,
    timestamp,
    reactions: {},
  };

  const seq = allocSeq();
  insertMessage.run(message.id, message.user, message.text, message.timestamp, seq, '{}', now);

  // BUG #3 (toggleable): broadcast delay
  const delayMs = BUGS.realtimeDelay ? 2000 + Math.random() * 2000 : 0;
  setTimeout(() => {
    const payload = JSON.stringify({ type: 'new_message', message });
    for (const ws of subscribers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // BUG #5 (toggleable): silently drop ~15% of broadcasts
      if (BUGS.broadcastDrop && Math.random() < 0.15) continue;
      ws.send(payload);
    }
  }, delayMs);

  return res.status(201).json(message);
});

const atomicIncrementReaction = db.prepare<[string, string, string]>(
  "UPDATE messages SET reactions = json_set(reactions, '$.' || ?, COALESCE(json_extract(reactions, '$.' || ?), 0) + 1) WHERE id = ?",
);

app.post('/messages/:id/react', (req: Request, res: Response) => {
  const id = String(req.params['id']);
  const { emoji } = req.body as { emoji?: string };
  if (!emoji) return res.status(400).json({ error: 'emoji required' });

  const row = selectById.get(id) as MessageRow | undefined;
  if (!row) return res.status(404).json({ error: 'Message not found' });

  if (BUGS.reactionRace) {
    // BUG #4: read-modify-write race with no row-level lock
    const reactions = JSON.parse(row.reactions) as Record<string, number>;
    const currentCount = reactions[emoji] ?? 0;
    setTimeout(() => {
      reactions[emoji] = currentCount + 1;
      updateReactions.run(JSON.stringify(reactions), id);
    }, Math.random() * 5);
    return res.json({ ok: true, emoji, count: currentCount + 1 });
  }

  // Clean path: atomic SQL-side increment, no race possible
  atomicIncrementReaction.run(emoji, emoji, id);
  const updated = selectById.get(id) as MessageRow;
  const updatedReactions = JSON.parse(updated.reactions) as Record<string, number>;
  return res.json({ ok: true, emoji, count: updatedReactions[emoji] ?? 0 });
});

app.delete('/messages', (_req: Request, res: Response) => {
  deleteAll.run();
  res.json({ cleared: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  subscribers.add(ws);
  const rows = (BUGS.orderViolation ? selectAllUnsorted : selectAllSorted).all() as MessageRow[];
  ws.send(JSON.stringify({ type: 'init', messages: rows.map(rowToMessage) }));
  ws.on('close', () => subscribers.delete(ws));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
server.listen(PORT, () => {
  console.log(`[demo-app] HTTP on http://localhost:${PORT}`);
  console.log(`[demo-app] WebSocket on ws://localhost:${PORT}/ws`);
  console.log(`[demo-app] SQLite at ${DB_PATH}`);
  const enabledBugs = Object.entries(BUGS)
    .filter(([, on]) => on)
    .map(([name]) => name);
  console.log(
    enabledBugs.length > 0
      ? `[demo-app] Active bugs: ${enabledBugs.join(', ')}`
      : '[demo-app] All bugs disabled (clean baseline mode)',
  );
});
