/**
 * Tests for the algorithms library: vector clocks, Bayesian inference,
 * and statistical primitives. These are pure-function tests with
 * deterministic inputs — no mocks needed.
 */
import { describe, expect, it } from 'vitest';
import { VectorClock, lamportTimestamp } from '../algorithms/vectorClock.js';
import {
  BUG_PRIORS,
  bayesianUpdate,
  compoundEvidence,
  featureToLikelihood,
} from '../algorithms/bayesian.js';
import { describe as descStats, welchTTest, mad, findOutliers } from '../algorithms/statistics.js';

// ─── VectorClock ──────────────────────────────────────────────────────────────

describe('VectorClock', () => {
  describe('tick', () => {
    it('increments the agent component starting from 0', () => {
      const c = new VectorClock();
      c.tick('a');
      expect(c.snapshot()).toEqual({ a: 1 });
      c.tick('a');
      expect(c.snapshot()).toEqual({ a: 2 });
    });

    it('tracks multiple agents independently', () => {
      const c = new VectorClock();
      c.tick('a').tick('b').tick('a');
      expect(c.snapshot()).toEqual({ a: 2, b: 1 });
    });
  });

  describe('merge', () => {
    it('takes the point-wise max of components', () => {
      const a = new VectorClock({ a: 3, b: 1 });
      const b = new VectorClock({ a: 1, b: 5, c: 2 });
      a.merge(b);
      expect(a.snapshot()).toEqual({ a: 3, b: 5, c: 2 });
    });

    it('does not modify the other clock', () => {
      const a = new VectorClock({ a: 1 });
      const b = new VectorClock({ b: 2 });
      a.merge(b);
      expect(b.snapshot()).toEqual({ b: 2 });
    });
  });

  describe('happensBefore', () => {
    it('returns true when this is strictly less than other', () => {
      const a = new VectorClock({ a: 1, b: 1 });
      const b = new VectorClock({ a: 2, b: 1 });
      expect(a.happensBefore(b)).toBe(true);
      expect(b.happensBefore(a)).toBe(false);
    });

    it('returns false for equal clocks', () => {
      const a = new VectorClock({ a: 1, b: 1 });
      const b = new VectorClock({ a: 1, b: 1 });
      expect(a.happensBefore(b)).toBe(false);
    });

    it('returns false for incomparable (concurrent) clocks', () => {
      const a = new VectorClock({ a: 2, b: 1 });
      const b = new VectorClock({ a: 1, b: 2 });
      expect(a.happensBefore(b)).toBe(false);
      expect(b.happensBefore(a)).toBe(false);
    });

    it('handles missing keys as zero', () => {
      const a = new VectorClock({ a: 1 });
      const b = new VectorClock({ a: 1, b: 1 });
      expect(a.happensBefore(b)).toBe(true);
    });
  });

  describe('isConcurrentWith', () => {
    it('detects concurrent events (no causal relation)', () => {
      const a = new VectorClock({ a: 2, b: 1 });
      const b = new VectorClock({ a: 1, b: 2 });
      expect(a.isConcurrentWith(b)).toBe(true);
      expect(b.isConcurrentWith(a)).toBe(true);
    });

    it('returns false when one happens-before the other', () => {
      const a = new VectorClock({ a: 1, b: 1 });
      const b = new VectorClock({ a: 2, b: 1 });
      expect(a.isConcurrentWith(b)).toBe(false);
    });

    it('returns false for equal clocks', () => {
      const a = new VectorClock({ a: 1 });
      const b = new VectorClock({ a: 1 });
      expect(a.isConcurrentWith(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('produces an independent copy', () => {
      const a = new VectorClock({ a: 1, b: 2 });
      const b = a.clone();
      b.tick('a');
      expect(a.snapshot()).toEqual({ a: 1, b: 2 });
      expect(b.snapshot()).toEqual({ a: 2, b: 2 });
    });
  });

  describe('lamportTimestamp', () => {
    it('produces total order from a vector clock', () => {
      const a = new VectorClock({ a: 1, b: 0 });
      const b = new VectorClock({ a: 1, b: 1 });
      // b has more total ticks, so its Lamport timestamp must be larger
      expect(lamportTimestamp(b, 'a')).toBeGreaterThan(lamportTimestamp(a, 'a'));
    });
  });
});

// ─── Bayesian ─────────────────────────────────────────────────────────────────

describe('bayesianUpdate', () => {
  it('increases posterior when evidence supports the bug', () => {
    const prior = 0.1;
    const posterior = bayesianUpdate(prior, { givenBug: 0.9, givenNoBug: 0.1 });
    expect(posterior).toBeGreaterThan(prior);
  });

  it('decreases posterior when evidence contradicts the bug', () => {
    const prior = 0.5;
    const posterior = bayesianUpdate(prior, { givenBug: 0.1, givenNoBug: 0.9 });
    expect(posterior).toBeLessThan(prior);
  });

  it('returns prior when both likelihoods are equal', () => {
    const prior = 0.3;
    const posterior = bayesianUpdate(prior, { givenBug: 0.5, givenNoBug: 0.5 });
    expect(posterior).toBeCloseTo(prior, 5);
  });

  it('handles zero denominator gracefully', () => {
    const posterior = bayesianUpdate(0.5, { givenBug: 0, givenNoBug: 0 });
    expect(posterior).toBe(0.5);
  });
});

describe('compoundEvidence', () => {
  it('starts from the bug-type prior', () => {
    const prior = BUG_PRIORS.race_condition;
    const result = compoundEvidence('race_condition', []);
    expect(result).toBeCloseTo(prior, 5);
  });

  it('compounds multiple supporting pieces of evidence', () => {
    const oneEvidence = compoundEvidence('race_condition', [{ givenBug: 0.8, givenNoBug: 0.2 }]);
    const twoEvidence = compoundEvidence('race_condition', [
      { givenBug: 0.8, givenNoBug: 0.2 },
      { givenBug: 0.8, givenNoBug: 0.2 },
    ]);
    expect(twoEvidence).toBeGreaterThan(oneEvidence);
  });

  it('clamps to [0.01, 0.99]', () => {
    const extreme = compoundEvidence(
      'race_condition',
      Array(100).fill({ givenBug: 1, givenNoBug: 0 }),
    );
    expect(extreme).toBeLessThanOrEqual(0.99);
    expect(extreme).toBeGreaterThanOrEqual(0.01);
  });
});

describe('featureToLikelihood', () => {
  it('produces high givenBug for observations far above threshold', () => {
    const result = featureToLikelihood(10, 1);
    expect(result.givenBug).toBeGreaterThan(0.9);
  });

  it('produces low givenBug for observations far below threshold', () => {
    const result = featureToLikelihood(0.01, 1);
    expect(result.givenBug).toBeLessThan(0.4);
  });

  it('produces near-equal likelihoods at threshold', () => {
    const result = featureToLikelihood(1, 1);
    expect(result.givenBug).toBeCloseTo(0.625, 1);
  });
});

// ─── Statistics ───────────────────────────────────────────────────────────────

describe('describe (stats)', () => {
  it('computes correct mean / median / stdDev', () => {
    const stats = descStats([1, 2, 3, 4, 5]);
    expect(stats.mean).toBe(3);
    expect(stats.median).toBe(3);
    expect(stats.stdDev).toBeCloseTo(1.5811, 3);
  });

  it('returns zero stats for empty input', () => {
    const stats = descStats([]);
    expect(stats.count).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.stdDev).toBe(0);
  });

  it('p95 and p99 reflect tail values', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = descStats(values);
    expect(stats.p95).toBeGreaterThanOrEqual(95);
    expect(stats.p99).toBeGreaterThanOrEqual(99);
  });
});

describe('welchTTest', () => {
  it('does not flag two equal distributions', () => {
    const a = [10, 10, 10, 10, 10];
    const b = [10, 10, 10, 10, 10];
    const result = welchTTest(a, b);
    expect(result.significant).toBe(false);
  });

  it('flags significantly different means', () => {
    // Need some variance for the t-statistic to be well-defined
    const a = Array.from({ length: 50 }, (_, i) => 10 + (i % 5));
    const b = Array.from({ length: 50 }, (_, i) => 100 + (i % 5));
    const result = welchTTest(a, b);
    expect(result.significant).toBe(true);
    expect(Math.abs(result.t)).toBeGreaterThan(2);
  });

  it('returns trivially insignificant for too-small samples', () => {
    const result = welchTTest([1], [1]);
    expect(result.significant).toBe(false);
    expect(result.pValue).toBe(1);
  });

  it('produces p-value in [0, 1]', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [3, 4, 5, 6, 7];
    const result = welchTTest(a, b);
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });
});

describe('mad and findOutliers', () => {
  it('mad on uniform input is zero', () => {
    const { mad: m } = mad([5, 5, 5, 5, 5]);
    expect(m).toBe(0);
  });

  it('finds clear outliers above the threshold', () => {
    const values = [10, 11, 9, 10, 11, 9, 10, 1000];
    const indices = findOutliers(values);
    expect(indices).toContain(7); // 1000 is the outlier
  });

  it('returns no outliers for tight distributions', () => {
    const values = [10, 11, 10, 11, 10, 11];
    expect(findOutliers(values)).toEqual([]);
  });
});
