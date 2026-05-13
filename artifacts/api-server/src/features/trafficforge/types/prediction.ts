export interface LoadSample {
  agentCount: number;
  avgResponseMs: number;
  cpuPercent: number;
  memoryMB: number;
  errorRate: number;
}

export interface Prediction {
  id: string;
  targetAgentCount: number;
  predicted: LoadSample;
  failurePoint?: number;
  confidenceInterval: { low: number; high: number };
  basedOnSamples: number;
  generatedAt: number;
}

export interface ScalingCurve {
  baseline: LoadSample;
  samples: LoadSample[];
  fit: {
    slope: number;
    intercept: number;
    rSquared: number;
  };
}
