import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

interface TestRun {
  id: string;
  total_requests: number | null;
  avg_response_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate: number | null;
  user_count: number | null;
  page_metrics: Record<string, { count: number; avgMs: number; errors: number }> | null;
  error_breakdown: Record<string, number> | null;
  started_at: string | null;
  ended_at: string | null;
}

function durationMs(run: TestRun): number | null {
  if (!run.started_at || !run.ended_at) return null;
  return new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
}

export default function Analytics() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');

  const { data: run, isLoading } = useQuery<TestRun | null>({
    queryKey: ['test-run-detail', runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await fetch(`/api/test-runs/${runId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!runId,
    refetchInterval: 5000,
  });

  // Latest run fallback when no runId selected
  const { data: latestRun } = useQuery<TestRun | null>({
    queryKey: ['latest-run'],
    queryFn: async () => {
      const res = await fetch('/api/test-runs');
      if (!res.ok) return null;
      const runs: TestRun[] = await res.json();
      return runs.find((r) => r.total_requests != null) ?? null;
    },
    enabled: !runId,
    refetchInterval: 10000,
  });

  const activeRun = run ?? latestRun;
  const pageMetrics = activeRun?.page_metrics ?? {};
  const errorBreakdown = activeRun?.error_breakdown ?? {};
  const pageRows = Object.entries(pageMetrics).map(([path, m]) => ({ path, ...m }));
  const testDuration = activeRun ? durationMs(activeRun) : null;
  const rps =
    testDuration && activeRun?.total_requests
      ? ((activeRun.total_requests / testDuration) * 1000).toFixed(1)
      : null;

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Analytics</h1>
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Analytics</h1>
        {activeRun && (
          <p className="text-sm text-muted-foreground">
            Run {activeRun.id.slice(0, 8)}…
            {activeRun.user_count != null ? ` · ${activeRun.user_count} users` : ''}
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Total Requests</p>
          <p className="text-2xl font-bold">{activeRun?.total_requests?.toLocaleString() ?? '—'}</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Avg / P95 / P99</p>
          <p className="text-2xl font-bold">
            {activeRun?.avg_response_ms != null ? `${activeRun.avg_response_ms.toFixed(0)}ms` : '—'}
          </p>
          {activeRun?.p95_ms != null && (
            <p className="text-xs text-muted-foreground mt-1">
              p95: {activeRun.p95_ms}ms · p99: {activeRun.p99_ms ?? '?'}ms
            </p>
          )}
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p
            className={`text-2xl font-bold ${(activeRun?.error_rate ?? 0) > 5 ? 'text-destructive' : ''}`}
          >
            {activeRun?.error_rate != null ? `${activeRun.error_rate.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Throughput</p>
          <p className="text-2xl font-bold">{rps != null ? `${rps}/s` : '—'}</p>
        </div>
      </div>

      {pageRows.length > 0 && (
        <div className="border rounded-lg bg-card p-4 mb-6">
          <h2 className="font-semibold mb-4">Page Metrics</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left p-3">Path</th>
                <th className="text-right p-3">Hits</th>
                <th className="text-right p-3">Avg (ms)</th>
                <th className="text-right p-3">Errors</th>
                <th className="text-right p-3">Error %</th>
              </tr>
            </thead>
            <tbody>
              {pageRows
                .sort((a, b) => b.count - a.count)
                .map((m) => (
                  <tr key={m.path} className="border-b hover:bg-accent/50">
                    <td className="p-3 font-mono text-xs">{m.path}</td>
                    <td className="p-3 text-right">{m.count.toLocaleString()}</td>
                    <td
                      className={`p-3 text-right ${m.avgMs > 1000 ? 'text-destructive font-medium' : ''}`}
                    >
                      {m.avgMs}
                    </td>
                    <td className="p-3 text-right text-destructive">{m.errors}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {m.count > 0 ? `${((m.errors / m.count) * 100).toFixed(1)}%` : '0%'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {Object.keys(errorBreakdown).length > 0 && (
        <div className="border rounded-lg bg-card p-4">
          <h2 className="font-semibold mb-4">Error Breakdown</h2>
          <div className="space-y-2">
            {Object.entries(errorBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div key={type} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{type}</span>
                  <span className="font-medium">{count.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {!activeRun && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          No test runs yet. Start a test from the{' '}
          <a href="/test-config" className="text-primary hover:underline">
            Test Config
          </a>{' '}
          page.
        </div>
      )}
    </div>
  );
}
