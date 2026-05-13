/**
 * Statistical primitives for bug and bottleneck detection.
 *
 * - Welch's t-test: compares two distributions with possibly unequal variances.
 *   Used to detect whether one agent group experiences statistically significant
 *   slowdown vs another (sync failure detection).
 * - Median Absolute Deviation: outlier detection robust to skewed distributions.
 * - Coefficient of variation: detect erratic latency under load.
 */

export interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  variance: number;
  cv: number; // coefficient of variation (stdDev / mean)
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export function describe(values: number[]): DescriptiveStats {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      variance: 0,
      cv: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1);
  const stdDev = Math.sqrt(variance);

  const percentile = (p: number) => sorted[Math.min(n - 1, Math.floor(n * p))];

  return {
    count: n,
    mean,
    median: percentile(0.5),
    stdDev,
    variance,
    cv: mean === 0 ? 0 : stdDev / mean,
    min: sorted[0],
    max: sorted[n - 1],
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

/**
 * Welch's t-test for two independent samples (unequal variance).
 * Returns t-statistic, degrees of freedom, and approximate two-sided p-value.
 *
 * Null hypothesis: the two groups have equal means.
 * Reject when p < alpha (default 0.05).
 */
export interface TTestResult {
  t: number;
  df: number;
  pValue: number;
  significant: boolean;
}

export function welchTTest(a: number[], b: number[], alpha = 0.05): TTestResult {
  if (a.length < 2 || b.length < 2) {
    return { t: 0, df: 0, pValue: 1, significant: false };
  }
  const sa = describe(a);
  const sb = describe(b);

  const seSquared = sa.variance / sa.count + sb.variance / sb.count;
  const t = (sa.mean - sb.mean) / Math.sqrt(seSquared);

  // Welch–Satterthwaite degrees of freedom
  const num = seSquared ** 2;
  const denomA = (sa.variance / sa.count) ** 2 / (sa.count - 1);
  const denomB = (sb.variance / sb.count) ** 2 / (sb.count - 1);
  const df = num / (denomA + denomB);

  // Approximate p-value via t-distribution survival function (two-sided)
  const pValue = 2 * studentTSurvival(Math.abs(t), df);

  return { t, df, pValue, significant: pValue < alpha };
}

/**
 * Survival function for Student's t-distribution (1 - CDF), approximated
 * via the regularized incomplete beta function. Accurate enough for
 * detection thresholds (p < 0.05, 0.01).
 */
function studentTSurvival(t: number, df: number): number {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return 0.5 * incompleteBeta(x, df / 2, 0.5);
}

/** Regularized incomplete beta function via continued fraction (Numerical Recipes). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Continued fraction (Lentz's method)
  let f = 1,
    c = 1,
    d = 0;
  for (let i = 0; i < 200; i++) {
    let num: number;
    if (i === 0) {
      num = 1;
    } else if (i % 2 === 0) {
      const m = i / 2;
      num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      const m = (i - 1) / 2;
      num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-8) break;
  }
  return front * (f - 1);
}

/** Log-gamma via Stirling's approximation (Lanczos coefficients). */
function logGamma(x: number): number {
  const coefs = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of coefs) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Median Absolute Deviation — robust outlier detection. */
export function mad(values: number[]): { median: number; mad: number } {
  if (values.length === 0) return { median: 0, mad: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: deviations[Math.floor(deviations.length / 2)] };
}

/** Returns indices of outliers (modified z-score > threshold). */
export function findOutliers(values: number[], threshold = 3.5): number[] {
  const { median, mad: madValue } = mad(values);
  if (madValue === 0) return [];
  return values
    .map((v, i) => ({ z: Math.abs((0.6745 * (v - median)) / madValue), i }))
    .filter(({ z }) => z > threshold)
    .map(({ i }) => i);
}
