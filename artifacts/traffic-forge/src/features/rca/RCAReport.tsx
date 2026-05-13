import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { CausalityGraph } from './CausalityGraph';
import { EvidencePanel } from '@/shared/components/EvidencePanel';

export interface RCAData {
  rootCause: string;
  hypothesis: string;
  confidence: number;
  causalChain: { step: number; description: string; type: string }[];
  evidence: { source: string; description: string; weight: number }[];
  recommendations: { priority: string; action: string; estimatedImpact: string }[];
}

interface AnalysisResult {
  status: string;
  rcaReports?: RCAData[];
  bugs?: { bug: { id: string; title: string; type: string; severity: string } }[];
}

export default function RCAReport() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const bugIndex = parseInt(searchParams.get('bug') ?? '0', 10);

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

  const rcaList = analysis?.rcaReports ?? [];
  const bugs = analysis?.bugs ?? [];
  const data: RCAData | undefined = rcaList[bugIndex];

  if (!runId) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Root Cause Analysis</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          No run selected. Go to Reports and click Analyze on a completed run.
        </div>
      </div>
    );
  }

  if (isLoading || analysis?.status === 'running') {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Root Cause Analysis</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          {analysis?.status === 'running' ? 'Claude is analyzing…' : 'Loading…'}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Root Cause Analysis</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          {analysis?.status === 'complete' && rcaList.length === 0
            ? 'No bugs found — no RCA needed!'
            : 'Run AI analysis first to generate root cause reports.'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Root Cause Analysis</h1>

      {bugs.length > 1 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {rcaList.map((_, i) => (
            <a
              key={i}
              href={`?runId=${runId}&bug=${i}`}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                i === bugIndex ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
              }`}
            >
              Bug {i + 1}: {bugs[i]?.bug?.title?.slice(0, 30) ?? `Issue ${i + 1}`}
            </a>
          ))}
        </div>
      )}

      <div className="border rounded-lg p-6 bg-card mb-6">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Root Cause</h2>
        <p className="text-base">{data.rootCause}</p>
        <p className="text-sm text-muted-foreground mt-2">
          Confidence: {(data.confidence * 100).toFixed(0)}%
        </p>
        <p className="text-sm mt-3 text-muted-foreground">{data.hypothesis}</p>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-xs font-semibold uppercase text-muted-foreground mb-3">
            Causal Chain
          </h2>
          <CausalityGraph chain={data.causalChain} />
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Evidence</h2>
          <EvidencePanel evidence={data.evidence} />
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase text-muted-foreground mb-3">
          Recommendations
        </h2>
        <div className="space-y-2">
          {data.recommendations.map((r, i) => (
            <div key={i} className="border rounded-lg p-3 bg-card">
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs font-semibold uppercase ${
                    r.priority === 'high'
                      ? 'text-destructive'
                      : r.priority === 'medium'
                        ? 'text-yellow-600'
                        : 'text-muted-foreground'
                  }`}
                >
                  {r.priority}
                </span>
                <span className="text-xs text-muted-foreground">{r.estimatedImpact}</span>
              </div>
              <p className="text-sm">{r.action}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
