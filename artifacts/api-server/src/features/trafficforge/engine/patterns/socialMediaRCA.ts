import type { RCAContext } from '../../types/rca.js';

export function analyzeSocialMediaBug(ctx: RCAContext): string {
  if (ctx.bug.type === 'order_violation') {
    return 'Posts are likely sorted by client-side timestamp, which differs across users due to clock skew. Use server-issued sequence number or DB timestamp.';
  }
  if (ctx.bug.type === 'realtime_sync_failure') {
    return 'Likes and comments not propagating quickly: WebSocket subscription likely not reattached after reconnect.';
  }
  return 'Generic social media issue';
}
