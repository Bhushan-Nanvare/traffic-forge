# Bug Patterns

Detected bug types and what triggers them.

## Race Condition

**Detected when:** Multiple writes to the same target within 100ms.

**Common cause:** Concurrent form submissions or API calls without locking.

## Persistence Failure

**Detected when:** Write actions return failed result.

**Common cause:** Database constraints, missing transactions, server timeouts.

## Real-Time Sync Failure

**Detected when:** > 10% of events take longer than 3 seconds with multiple agents.

**Common cause:** WebSocket lag, polling intervals, server-side broadcast delays.

## Order Violation (Social Media)

**Detected when:** Posts appear out of chronological order.

**Common cause:** Sorting by client timestamp instead of server timestamp.

## Cart Inconsistency (E-commerce)

**Detected when:** Cart operations fail.

**Common cause:** Inventory race conditions, stale cart state.

## Slow Message Delivery (Chat)

**Detected when:** Message sends take longer than 2 seconds.

**Common cause:** Synchronous DB writes, missing message queues.
