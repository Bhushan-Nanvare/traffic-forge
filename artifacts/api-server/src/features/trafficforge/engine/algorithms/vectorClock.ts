/**
 * Vector clocks for causal ordering of distributed events.
 *
 * In a distributed load test, each agent maintains a logical clock that
 * increments on every action. The full vector clock at event-time captures
 * the causal history from this agent's perspective. Two events are
 * concurrent (and therefore racy) if neither's vector dominates the other.
 *
 * References:
 *  - Fidge, "Timestamps in Message-Passing Systems" (1988)
 *  - Mattern, "Virtual Time and Global States" (1989)
 */

export class VectorClock {
  private readonly clock: Map<string, number>;

  constructor(initial?: Record<string, number>) {
    this.clock = new Map(initial ? Object.entries(initial) : []);
  }

  /** Increment this agent's local component. */
  tick(agentId: string): this {
    this.clock.set(agentId, (this.clock.get(agentId) ?? 0) + 1);
    return this;
  }

  /** Merge another clock (point-wise max), used when agents observe each other. */
  merge(other: VectorClock): this {
    for (const [agentId, count] of other.clock) {
      const local = this.clock.get(agentId) ?? 0;
      if (count > local) this.clock.set(agentId, count);
    }
    return this;
  }

  /** Returns true iff `this` strictly happens-before `other`. */
  happensBefore(other: VectorClock): boolean {
    let strictlyLess = false;
    const allAgents = new Set([...this.clock.keys(), ...other.clock.keys()]);

    for (const agentId of allAgents) {
      const a = this.clock.get(agentId) ?? 0;
      const b = other.clock.get(agentId) ?? 0;
      if (a > b) return false;
      if (a < b) strictlyLess = true;
    }
    return strictlyLess;
  }

  /** Two events are concurrent if neither's clock dominates the other. */
  isConcurrentWith(other: VectorClock): boolean {
    return !this.happensBefore(other) && !other.happensBefore(this) && !this.equals(other);
  }

  equals(other: VectorClock): boolean {
    if (this.clock.size !== other.clock.size) return false;
    for (const [agentId, count] of this.clock) {
      if ((other.clock.get(agentId) ?? 0) !== count) return false;
    }
    return true;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.clock);
  }

  clone(): VectorClock {
    return new VectorClock(this.snapshot());
  }
}

/** Lamport timestamp — total-orderable scalar derived from the same per-agent counter. */
export function lamportTimestamp(clock: VectorClock, agentId: string): number {
  const snap = clock.snapshot();
  // Lamport = sum of vector components is a valid extension that preserves causality
  return Object.values(snap).reduce((s, v) => s + v, 0) * 1000 + (snap[agentId] ?? 0);
}
