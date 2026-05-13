import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PerformanceChart } from './PerformanceChart';

export interface BottleneckReport {
  id: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  metric: string;
  observed: number;
  threshold: number;
  evidence: string[];
  recommendation: string;
}

interface AnalysisResult {
  status: string;
  bottlenecks?: BottleneckReport[];
}

interface TestRun {
  id: string;
  created_at: string;
  status: string;
}

const severityColor: Record<string, string> = {
  high: 'text-destructive',
  medium: 'text-yellow-600',
  low: 'text-muted-foreground',
};

export default function BottleneckAnalysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get('runId');

  const { data: runs = [] } = useQuery<TestRun[]>({
    queryKey: ['test-runs'],
    queryFn: async () => {
      const res = await fetch('/api/test-runs');
      return res.ok ? res.json() : [];
    },
    refetchInterval: 10000,
  });

  const completedRuns = runs.filter((r) => r.status === 'completed');

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

  const reports: BottleneckReport[] = analysis?.bottlenecks ?? [];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold">Bottleneck Analysis</h1>
        {completedRuns.length > 0 && (
          <select
            value={runId ?? ''}
            onChange={(e) => {
              if (e.target.value) setSearchParams({ runId: e.target.value });
              else setSearchParams({});
            }}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select a run…</option>
            {completedRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.created_at).toLocaleDateString()}{' '}
                {new Date(r.created_at).toLocaleTimeString()} — {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-6">
        <PerformanceChart />
      </div>

      {isLoading || analysis?.status === 'running' ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          {analysis?.status === 'running' ? 'Detecting bottlenecks…' : 'Loading…'}
        </div>
      ) : reports.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          {!runId
            ? completedRuns.length === 0
              ? 'No completed runs yet. Run a load test first.'
              : 'Select a run from the dropdown above to view bottleneck analysis.'
            : analysis?.status === 'complete'
              ? 'No bottlenecks detected — performance looks healthy!'
              : 'Run AI analysis from the Reports page to detect bottlenecks'}
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="border rounded-lg p-4 bg-card">
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${severityColor[r.severity]}`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-sm">{r.description}</h3>
                    <span className={`text-xs font-medium uppercase ${severityColor[r.severity]}`}>
                      {r.severity}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {r.category} · {r.metric}: <span className="font-mono">{r.observed}</span>
                    <span className="text-muted-foreground/60"> (threshold: {r.threshold})</span>
                  </p>
                  {r.evidence.length > 0 && (
                    <ul className="text-xs text-muted-foreground mb-2 list-disc list-inside">
                      {r.evidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-sm">{r.recommendation}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
