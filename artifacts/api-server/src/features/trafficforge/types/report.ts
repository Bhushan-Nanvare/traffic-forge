import type { DetectedBug } from './bug.js';
import type { AgentEvent } from '../engine/agentExecutor.js';

export interface TestReport {
  id: string;
  url: string;
  appType: string;
  summary: string;
  bugs: BugReport[];
  metrics: ReportMetrics;
  recommendations: string[];
  generatedAt: number;
}

export interface BugReport {
  bug: DetectedBug;
  rootCause?: string;
  suggestedFix?: string;
  reproductionSteps?: string[];
  codeReference?: { file: string; line?: number };
}

export interface ReportMetrics {
  totalEvents: number;
  failedEvents: number;
  avgDuration: number;
  uniqueAgents: number;
  testDurationMs: number;
}

export interface ReporterInput {
  url: string;
  appType: string;
  bugs: DetectedBug[];
  events: AgentEvent[];
}
