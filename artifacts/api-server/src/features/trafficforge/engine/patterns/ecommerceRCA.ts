import type { RCAContext } from '../../types/rca.js';

export function analyzeEcommerceBug(ctx: RCAContext): string {
  if (ctx.bug.type === 'data_inconsistency') {
    return 'Cart inconsistency: client-side cart not reconciled with server inventory. Add inventory check at checkout.';
  }
  if (ctx.bug.type === 'race_condition') {
    return 'Concurrent purchases of last-stock item: missing row-level locking on inventory. Use SELECT FOR UPDATE.';
  }
  return 'Generic e-commerce issue';
}
