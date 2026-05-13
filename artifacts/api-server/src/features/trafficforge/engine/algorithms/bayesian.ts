/**
 * Bayesian confidence scoring for bug detection.
 *
 * Rather than assigning magic-number confidence values (0.75, 0.85), we model
 * each detector as P(bug | evidence) using Bayes' rule:
 *
 *     P(bug | evidence) = P(evidence | bug) * P(bug) / P(evidence)
 *
 * - P(bug)        — prior probability of the bug type in real apps
 * - P(evidence|bug)    — true positive rate (sensitivity)
 * - P(evidence|¬bug)   — false positive rate
 *
 * Multiple independent pieces of evidence compound via repeated Bayesian update.
 */

export type BugTypeKey =
  | 'race_condition'
  | 'persistence_failure'
  | 'realtime_sync_failure'
  | 'data_inconsistency'
  | 'order_violation'
  | 'visibility_failure'
  | 'unknown';

/** Prior probability of each bug type, derived from public bug-tracker analyses. */
export const BUG_PRIORS: Record<BugTypeKey, number> = {
  race_condition: 0.15, // Race conditions are common in concurrent systems
  persistence_failure: 0.1, // Less common; usually caught in QA
  realtime_sync_failure: 0.2, // Very common in WebSocket apps
  data_inconsistency: 0.12,
  order_violation: 0.18, // Common with client-supplied timestamps
  visibility_failure: 0.08,
  unknown: 0.05,
};

export interface EvidenceLikelihood {
  /** P(this evidence | bug is real) — 0 to 1 */
  givenBug: number;
  /** P(this evidence | no bug) — 0 to 1 */
  givenNoBug: number;
}

/**
 * Single Bayesian update: prior + evidence → posterior.
 * Returns updated probability that the bug is real.
 */
export function bayesianUpdate(prior: number, evidence: EvidenceLikelihood): number {
  const numerator = evidence.givenBug * prior;
  const denominator = numerator + evidence.givenNoBug * (1 - prior);
  if (denominator === 0) return prior;
  return numerator / denominator;
}

/**
 * Apply multiple independent pieces of evidence to update confidence.
 * Naive Bayes assumption: pieces of evidence are conditionally independent.
 */
export function compoundEvidence(bugType: BugTypeKey, evidenceList: EvidenceLikelihood[]): number {
  let posterior = BUG_PRIORS[bugType];
  for (const evidence of evidenceList) {
    posterior = bayesianUpdate(posterior, evidence);
  }
  return Math.min(0.99, Math.max(0.01, posterior));
}

/**
 * Convert an observed feature value into an evidence likelihood.
 * Higher values produce stronger evidence (asymptote at 1.0).
 *
 * Sigmoid-style mapping: features near `threshold` give weak evidence,
 * features far above produce strong evidence.
 */
export function featureToLikelihood(
  observed: number,
  threshold: number,
  baseRate: number = 0.05,
): EvidenceLikelihood {
  if (threshold <= 0) return { givenBug: 0.5, givenNoBug: 0.5 };
  const ratio = observed / threshold;
  // Sigmoid: low when below threshold, high when above
  const sensitivity = 1 / (1 + Math.exp(-3 * (ratio - 1)));
  return {
    givenBug: 0.3 + 0.65 * sensitivity, // 0.3–0.95 sensitivity
    givenNoBug: baseRate + (1 - baseRate) * (1 - sensitivity) * 0.3, // tail off
  };
}
