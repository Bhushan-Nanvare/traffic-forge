import type { AgentEvent } from '../engine/agentExecutor.js';

export type BugType =
  | 'race_condition'
  | 'persistence_failure'
  | 'realtime_sync_failure'
  | 'data_inconsistency'
  | 'order_violation'
  | 'visibility_failure'
  | 'unknown';

export type BugSeverity = 'high' | 'medium' | 'low';

export interface DetectedBug {
  id: string;
  type: BugType;
  severity: BugSeverity;
  title: string;
  description: string;
  evidence: BugEvidence[];
  confidence: number;
  appType?: string;
  detectedAt: number;
}

export interface BugEvidence {
  type: 'event' | 'timing' | 'inconsistency';
  description: string;
  events?: AgentEvent[];
  timestamp: number;
}

export interface DetectorContext {
  events: AgentEvent[];
  appType: string;
  agentCount: number;
}

export interface PatternMatcher {
  name: string;
  detect(ctx: DetectorContext): DetectedBug[];
}
