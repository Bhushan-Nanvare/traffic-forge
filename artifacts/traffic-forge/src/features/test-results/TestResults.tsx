import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BugCard } from '@/shared/components/BugCard';
import BugDetail from './BugDetail';
import { AlertTriangle, AlertCircle, Info, RefreshCw, Brain, FileDown } from 'lucide-react';

export interface BugReport {
  bug: {
    id: string;
    type: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    confidence: number;
  };
  rootCause?: string;
  suggestedFix?: string;
  reproductionSteps?: string[];
}

interface AnalysisResult {
  runId: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  error?: string;
  bugs?: BugReport[];
  cost?: { estimatedUsd: number };
  analyzedAt?: number;
}

export default function TestResults() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const [selected, setSelected] = useState<BugReport | null>(null);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const queryClient = useQueryClient();

  const { data: analysis, isLoading } = useQuery<AnalysisResult>({
    queryKey: ['analysis', runId],
    queryFn: async () => {
      const res = await fetch(`/api/test-runs/${runId}/analysis`);
      if (!res.ok) return { runId: runId ?? '', status: 'pending' as const };
      return res.json();
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      return data.status === 'running' || data.status === 'pending' ? 2000 : false;
    },
  });

  const triggerAnalysis = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/test-runs/${runId}/analyze`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start analysis');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', runId] });
    },
  });

  const bugs: BugReport[] = analysis?.bugs ?? [];

  const filtered = useMemo(() => {
    if (filter === 'all') return bugs;
    return bugs.filter((b) => b.bug.severity === filter);
  }, [bugs, filter]);

  const counts = {
    high: bugs.filter((b) => b.bug.severity === 'high').length,
    medium: bugs.filter((b) => b.bug.severity === 'medium').length,
    low: bugs.filter((b) => b.bug.severity === 'low').length,
  };

  const isAnalyzing =
    analysis?.status === 'running' || analysis?.status === 'pending' || triggerAnalysis.isPending;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Test Results</h1>
          <p className="text-muted-foreground">
            {runId ? `Run: ${runId.slice(0, 8)}…` : 'No active run'} — Found {bugs.length} issue
            {bugs.length !== 1 ? 's' : ''}
          </p>
          {analysis?.cost && (
            <p className="text-xs text-muted-foreground mt-1">
              AI analysis cost: ${analysis.cost.estimatedUsd.toFixed(4)}
            </p>
          )}
        </div>

        {runId && (
          <div className="flex gap-2">
            {analysis?.status === 'complete' && (
              <a
                href={`/api/test-runs/${runId}/analysis.pdf`}
                download
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="Download report as PDF"
              >
                <FileDown className="w-4 h-4" aria-hidden="true" />
                PDF
              </a>
            )}
            <button
              type="button"
              onClick={() => triggerAnalysis.mutate()}
              disabled={isAnalyzing}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {isAnalyzing ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Brain className="w-4 h-4" aria-hidden="true" />
              )}
              {isAnalyzing
                ? 'Analyzing…'
                : analysis?.status === 'complete'
                  ? 'Re-analyze'
                  : 'Run AI Analysis'}
            </button>
          </div>
        )}
      </div>

      {analysis?.status === 'error' && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          Analysis failed: {analysis.error}
        </div>
      )}

      {isAnalyzing && (
        <div className="mb-4 p-4 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <RefreshCw className="inline w-4 h-4 mr-2 animate-spin" />
          Claude is analyzing your test results for race conditions and performance issues…
        </div>
      )}

      <div
        className="grid grid-cols-3 gap-4 mb-6"
        role="group"
        aria-label="Filter bugs by severity"
      >
        <button
          type="button"
          aria-pressed={filter === 'high'}
          aria-label={`Filter by high severity, ${counts.high} bugs`}
          onClick={() => setFilter(filter === 'high' ? 'all' : 'high')}
          className={`p-4 border rounded-lg text-left bg-card transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${filter === 'high' ? 'ring-2 ring-destructive' : ''}`}
        >
          <AlertTriangle className="w-5 h-5 text-destructive mb-2" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">High Severity</p>
          <p className="text-2xl font-bold">{counts.high}</p>
        </button>
        <button
          type="button"
          aria-pressed={filter === 'medium'}
          aria-label={`Filter by medium severity, ${counts.medium} bugs`}
          onClick={() => setFilter(filter === 'medium' ? 'all' : 'medium')}
          className={`p-4 border rounded-lg text-left bg-card transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${filter === 'medium' ? 'ring-2 ring-yellow-500' : ''}`}
        >
          <AlertCircle className="w-5 h-5 text-yellow-500 mb-2" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">Medium Severity</p>
          <p className="text-2xl font-bold">{counts.medium}</p>
        </button>
        <button
          type="button"
          aria-pressed={filter === 'low'}
          aria-label={`Filter by low severity, ${counts.low} bugs`}
          onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}
          className={`p-4 border rounded-lg text-left bg-card transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${filter === 'low' ? 'ring-2 ring-primary' : ''}`}
        >
          <Info className="w-5 h-5 text-primary mb-2" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">Low Severity</p>
          <p className="text-2xl font-bold">{counts.low}</p>
        </button>
      </div>

      {isLoading ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          {!runId
            ? 'Select a test run to view results'
            : bugs.length === 0
              ? analysis?.status === 'complete'
                ? 'No bugs detected — your app looks healthy under load!'
                : 'Click "Run AI Analysis" to detect bugs with Claude'
              : 'No bugs match the selected filter'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((report) => (
            <BugCard key={report.bug.id} report={report} onClick={() => setSelected(report)} />
          ))}
        </div>
      )}

      {selected && <BugDetail report={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
