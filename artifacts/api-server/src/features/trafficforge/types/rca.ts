import type { DetectedBug } from './bug.js';

export interface RCAReport {
  id: string;
  bugId: string;
  /** The top-ranked hypothesis (alternatives[0] for backwards compatibility). */
  rootCause: string;
  causalChain: CausalLink[];
  evidence: RCAEvidence[];
  hypothesis: string;
  confidence: number;
  recommendations: RCARecommendation[];
  /**
   * Ranked alternative hypotheses. Index 0 is the same as `rootCause` above.
   * Useful when the primary hypothesis is wrong — actionable next-best guesses.
   */
  alternatives?: AlternativeHypothesis[];
  generatedAt: number;
}

export interface AlternativeHypothesis {
  rank: number;
  rootCause: string;
  description: string;
  confidence: number;
  /** Why this alternative is plausible relative to the primary. */
  rationale: string;
}

export interface CausalLink {
  step: number;
  description: string;
  type: 'observation' | 'inference' | 'conclusion';
}

export interface RCAEvidence {
  source: 'log' | 'metric' | 'event' | 'pattern';
  description: string;
  weight: number;
}

export interface RCARecommendation {
  priority: 'high' | 'medium' | 'low';
  action: string;
  estimatedImpact: string;
}

export interface RCAContext {
  bug: DetectedBug;
  appType: string;
  events: any[];
  metrics?: Record<string, number>;
}
