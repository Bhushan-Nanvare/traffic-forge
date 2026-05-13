import type { RCAContext } from '../../types/rca.js';

export function analyzeChatBug(ctx: RCAContext): string {
  if (ctx.bug.type === 'realtime_sync_failure') {
    return 'Message delivery slow: server is doing synchronous DB writes before broadcasting. Move to write-then-broadcast pattern.';
  }
  if (ctx.bug.type === 'persistence_failure') {
    return 'Messages dropped: writes too close together hit a rate limit or constraint. Add a write queue.';
  }
  return 'Generic chat issue';
}
