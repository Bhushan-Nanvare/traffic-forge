import type { AgentEvent } from '../engine/agentExecutor.js';

export type BottleneckCategory =
  | 'cpu'
  | 'memory'
  | 'database'
  | 'network'
  | 'cache'
  | 'connection_pool';

export interface BottleneckReport {
  id: string;
  category: BottleneckCategory;
  severity: 'high' | 'medium' | 'low';
  description: string;
  metric: string;
  threshold: number;
  observed: number;
  evidence: string[];
  recommendation: string;
  detectedAt: number;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface EndpointStats {
  path: string;
  count: number;
  percentiles: PercentileStats;
  errorRate: number;
}

export interface BottleneckContext {
  events: AgentEvent[];
  endpointStats: EndpointStats[];
  resourceStats?: {
    cpuPercent: number;
    memoryMB: number;
    inFlight: number;
  };
}
