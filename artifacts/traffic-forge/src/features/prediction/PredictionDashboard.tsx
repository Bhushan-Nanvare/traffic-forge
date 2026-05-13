import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { ScenarioComparison } from './ScenarioComparison';
import { CapacityPlanner } from '@/shared/components/CapacityPlanner';

export interface PredictionData {
  targetAgentCount: number;
  predicted: {
    agentCount: number;
    avgResponseMs: number;
    cpuPercent: number;
    memoryMB: number;
    errorRate: number;
  };
  failurePoint?: number;
  confidenceInterval: { low: number; high: number };
  basedOnSamples: number;
}

interface AnalysisResult {
  status: string;
  prediction?: PredictionData;
}

export default function PredictionDashboard() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');

  const { data: analysis, isLoading } = useQuery<AnalysisResult>({
    queryKey: ['analysis', runId],
    queryFn: async () => {
      const res = await fetch(`/api/test-runs/${runId}/analysis`);
      if (!res.ok) return { status: 'pending' };
      return res.json();
    },
    enabled: !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'pending' ? 2000 : false;
    },
  });

  const data = analysis?.prediction;

  if (isLoading || analysis?.status === 'running') {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Performance Predictions</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          Computing predictions…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Performance Predictions</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          {!runId
            ? 'Select a run to view predictions'
            : analysis?.status === 'complete'
              ? 'Not enough data to predict — run a longer test with more users'
              : 'Run AI analysis from the Reports page to generate predictions'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Performance Predictions</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Extrapolated from {data.basedOnSamples} sample point{data.basedOnSamples !== 1 ? 's' : ''}
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Target Load</p>
          <p className="text-2xl font-bold">{data.targetAgentCount} users</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Predicted Response</p>
          <p className="text-2xl font-bold">{data.predicted.avgResponseMs.toFixed(0)}ms</p>
          <p className="text-xs text-muted-foreground mt-1">
            [{data.confidenceInterval.low.toFixed(0)}–{data.confidenceInterval.high.toFixed(0)}ms]
          </p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Predicted CPU</p>
          <p className="text-2xl font-bold">{data.predicted.cpuPercent.toFixed(0)}%</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Failure Point</p>
          <p className="text-2xl font-bold">
            {data.failurePoint != null ? `${data.failurePoint} users` : 'N/A'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ScenarioComparison data={data} />
        <CapacityPlanner data={data} />
      </div>
    </div>
  );
}
