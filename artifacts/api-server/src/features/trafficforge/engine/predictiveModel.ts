/**
 * Predictive Performance Model.
 *
 * Predicts performance at higher load levels by fitting multiple regression
 * models (linear, polynomial, exponential) to observed samples and selecting
 * the model with the best fit (highest R-squared on training data).
 *
 * This matters because real load curves are usually super-linear:
 *  - Database/CPU contention causes exponential latency growth above saturation
 *  - Connection-pool starvation produces a hockey-stick shape (polynomial)
 *  - Pure linear extrapolation systematically under-predicts failure points
 */
import type { LoadSample, Prediction, ScalingCurve } from '../types/prediction.js';

type ModelKind = 'linear' | 'polynomial' | 'exponential';

interface FitResult {
  kind: ModelKind;
  rSquared: number;
  /** Model parameters; meaning depends on `kind`. */
  params: number[];
  /** Evaluate the fitted model at point x. */
  evaluate: (x: number) => number;
}

export class PredictiveModel {
  predict(samples: LoadSample[], targetAgentCount: number): Prediction {
    if (samples.length < 2) {
      throw new Error('Need at least 2 samples to predict');
    }

    const responseFit = this.fitBest(samples.map((s) => ({ x: s.agentCount, y: s.avgResponseMs })));
    const cpuFit = this.fitBest(samples.map((s) => ({ x: s.agentCount, y: s.cpuPercent })));
    const memFit = this.fitBest(samples.map((s) => ({ x: s.agentCount, y: s.memoryMB })));
    const errorFit = this.fitBest(samples.map((s) => ({ x: s.agentCount, y: s.errorRate })));

    const predicted: LoadSample = {
      agentCount: targetAgentCount,
      avgResponseMs: responseFit.evaluate(targetAgentCount),
      cpuPercent: cpuFit.evaluate(targetAgentCount),
      memoryMB: memFit.evaluate(targetAgentCount),
      errorRate: Math.max(0, errorFit.evaluate(targetAgentCount)),
    };

    const failurePoint = this.findFailurePoint(cpuFit);
    const confidence = this.confidenceInterval(predicted.avgResponseMs, responseFit.rSquared);

    return {
      id: `pred-${Date.now()}`,
      targetAgentCount,
      predicted,
      failurePoint,
      confidenceInterval: confidence,
      basedOnSamples: samples.length,
      generatedAt: Date.now(),
    };
  }

  buildCurve(samples: LoadSample[]): ScalingCurve {
    const responseFit = this.fitBest(samples.map((s) => ({ x: s.agentCount, y: s.avgResponseMs })));
    // Backwards-compatible: ScalingCurve.fit fields match the linear shape,
    // even when the chosen model is polynomial/exponential — slope and
    // intercept are derived from the model's first two parameters.
    const slope = responseFit.params[1] ?? 0;
    const intercept = responseFit.params[0] ?? 0;
    return {
      baseline: samples[0],
      samples,
      fit: {
        slope,
        intercept,
        rSquared: responseFit.rSquared,
      },
    };
  }

  // ─── Model Selection ──────────────────────────────────────────────────────

  /**
   * Try linear, polynomial (degree 2), and exponential fits; return the one
   * with the highest R-squared on the training data. With small sample
   * counts (< 4) we skip polynomial/exponential to avoid overfitting.
   */
  private fitBest(points: { x: number; y: number }[]): FitResult {
    const candidates: FitResult[] = [this.fitLinear(points)];
    if (points.length >= 4) {
      candidates.push(this.fitPolynomial(points, 2));
    }
    if (points.length >= 3 && points.every((p) => p.y > 0)) {
      const expFit = this.fitExponential(points);
      if (expFit) candidates.push(expFit);
    }
    return candidates.reduce((best, c) => (c.rSquared > best.rSquared ? c : best));
  }

  // ─── Linear Regression ────────────────────────────────────────────────────

  private fitLinear(points: { x: number; y: number }[]): FitResult {
    const n = points.length;
    if (n === 0) {
      return { kind: 'linear', rSquared: 0, params: [0, 0], evaluate: () => 0 };
    }
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    return {
      kind: 'linear',
      rSquared: this.computeRSquared(points, (x) => slope * x + intercept),
      params: [intercept, slope],
      evaluate: (x) => slope * x + intercept,
    };
  }

  // ─── Polynomial Regression (degree d) ─────────────────────────────────────

  /**
   * Polynomial fit via the normal equations: solve (X^T X) β = X^T y for β.
   * Uses Gauss–Jordan elimination on the (d+1)×(d+1) coefficient matrix —
   * fine for d ≤ 5 which is all we need.
   */
  private fitPolynomial(points: { x: number; y: number }[], degree: number): FitResult {
    const d = degree;

    // Build X^T X — symmetric (d+1)x(d+1) matrix of summed power products
    const xtx: number[][] = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    const xty: number[] = new Array(d + 1).fill(0);

    for (const p of points) {
      const powers: number[] = new Array(d + 1);
      powers[0] = 1;
      for (let i = 1; i <= d; i++) powers[i] = powers[i - 1] * p.x;

      for (let i = 0; i <= d; i++) {
        xty[i] += powers[i] * p.y;
        for (let j = 0; j <= d; j++) {
          xtx[i][j] += powers[i] * powers[j];
        }
      }
    }

    const coeffs = solveLinearSystem(xtx, xty);
    if (!coeffs) {
      // Singular matrix — fall back to linear
      return this.fitLinear(points);
    }

    const evaluate = (x: number): number => {
      let result = 0;
      let xPow = 1;
      for (let i = 0; i <= d; i++) {
        result += coeffs[i] * xPow;
        xPow *= x;
      }
      return result;
    };

    return {
      kind: 'polynomial',
      rSquared: this.computeRSquared(points, evaluate),
      params: coeffs,
      evaluate,
    };
  }

  // ─── Exponential Regression (y = a * exp(b * x)) ──────────────────────────

  /**
   * Linearise via log: ln(y) = ln(a) + b * x, then linear-regress on (x, ln(y)).
   * Returns null if any y ≤ 0 (log undefined).
   */
  private fitExponential(points: { x: number; y: number }[]): FitResult | null {
    if (points.some((p) => p.y <= 0)) return null;

    const linearised = points.map((p) => ({ x: p.x, y: Math.log(p.y) }));
    const linFit = this.fitLinear(linearised);

    const lnA = linFit.params[0];
    const b = linFit.params[1];
    const a = Math.exp(lnA);

    const evaluate = (x: number): number => a * Math.exp(b * x);

    return {
      kind: 'exponential',
      rSquared: this.computeRSquared(points, evaluate),
      params: [a, b],
      evaluate,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private computeRSquared(
    points: { x: number; y: number }[],
    predict: (x: number) => number,
  ): number {
    if (points.length === 0) return 0;
    const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
    const ssTotal = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
    const ssRes = points.reduce((s, p) => s + (p.y - predict(p.x)) ** 2, 0);
    return ssTotal > 0 ? Math.max(0, 1 - ssRes / ssTotal) : 0;
  }

  private findFailurePoint(cpuFit: FitResult): number | undefined {
    const failureCpu = 95;

    // Linear: closed-form solve. Polynomial/exponential: binary search.
    if (cpuFit.kind === 'linear') {
      const intercept = cpuFit.params[0];
      const slope = cpuFit.params[1];
      if (slope <= 0) return undefined;
      return Math.ceil((failureCpu - intercept) / slope);
    }

    // Binary search for the smallest x where evaluate(x) >= 95
    if (cpuFit.evaluate(1) >= failureCpu) return 1;
    const hi = 100_000;
    if (cpuFit.evaluate(hi) < failureCpu) return undefined; // never reaches 95% in range
    let lo = 1;
    let high = hi;
    while (lo < high) {
      const mid = Math.floor((lo + high) / 2);
      if (cpuFit.evaluate(mid) >= failureCpu) high = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private confidenceInterval(value: number, rSquared: number): { low: number; high: number } {
    const uncertainty = (1 - rSquared) * 0.5 * value;
    return { low: Math.max(0, value - uncertainty), high: value + uncertainty };
  }
}

// ─── Linear Algebra: Gauss-Jordan ───────────────────────────────────────────

/**
 * Solve a × x = b for x via Gauss-Jordan elimination with partial pivoting.
 * Returns null if the matrix is singular.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = a.length;
  // Build augmented matrix [a | b]
  const m: number[][] = a.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // Pivot: find row with largest absolute value in column i
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
    }
    if (Math.abs(m[pivot][i]) < 1e-12) return null; // singular
    if (pivot !== i) [m[i], m[pivot]] = [m[pivot], m[i]];

    // Normalize pivot row
    const div = m[i][i];
    for (let c = i; c <= n; c++) m[i][c] /= div;

    // Eliminate column i in all other rows
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = m[r][i];
      if (factor === 0) continue;
      for (let c = i; c <= n; c++) m[r][c] -= factor * m[i][c];
    }
  }

  return m.map((row) => row[n]);
}
