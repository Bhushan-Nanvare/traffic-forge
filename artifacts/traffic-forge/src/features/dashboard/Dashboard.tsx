import { useSearchParams, Link } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';
import { Brain, BarChart2, Bug, GitBranch, Gauge } from 'lucide-react';

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { stats, isLive, enriched } = useLiveData(runId);

  const isComplete = enriched?.status === 'completed' || enriched?.status === 'cancelled';

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span className={isLive ? 'text-green-500' : 'text-muted-foreground'}>
              {isLive ? '● Live' : '● Offline'}
            </span>
            {runId && <span>Run: {runId.slice(0, 8)}…</span>}
            {enriched?.status && (
              <span className="capitalize px-2 py-0.5 bg-muted rounded text-xs">
                {enriched.status}
              </span>
            )}
          </div>
        </div>

        {runId && isComplete && (
          <div className="flex gap-2">
            <Link
              to={`/results?runId=${runId}`}
              className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-accent"
            >
              <Bug className="w-4 h-4" />
              Results
            </Link>
            <Link
              to={`/rca?runId=${runId}`}
              className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-accent"
            >
              <GitBranch className="w-4 h-4" />
              RCA
            </Link>
            <Link
              to={`/bottleneck?runId=${runId}`}
              className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-accent"
            >
              <Gauge className="w-4 h-4" />
              Bottlenecks
            </Link>
            <Link
              to={`/results?runId=${runId}`}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              <Brain className="w-4 h-4" />
              AI Analysis
            </Link>
          </div>
        )}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Active Agents</p>
          <p className="text-2xl font-bold">{stats.activeAgents}</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Requests/sec</p>
          <p className="text-2xl font-bold">{stats.requestsPerSecond.toFixed(1)}</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Avg Response</p>
          <p className="text-2xl font-bold">{stats.avgResponse}ms</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p className={`text-2xl font-bold ${stats.errorRate > 5 ? 'text-destructive' : ''}`}>
            {typeof stats.errorRate === 'number' ? stats.errorRate.toFixed(1) : '0.0'}%
          </p>
        </div>
      </div>

      {enriched && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 border rounded-lg bg-card">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-xl font-bold">{enriched.completed?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className="text-xl font-bold text-destructive">
              {enriched.failed?.toLocaleString() ?? '—'}
            </p>
          </div>
          <div className="p-4 border rounded-lg bg-card">
            <p className="text-xs text-muted-foreground">P95 Latency</p>
            <p className="text-xl font-bold">
              {enriched.p95Ms != null ? `${enriched.p95Ms}ms` : '—'}
            </p>
          </div>
        </div>
      )}

      {enriched?.pageMetrics && Object.keys(enriched.pageMetrics).length > 0 && (
        <div className="border rounded-lg bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4" />
            <h2 className="font-semibold text-sm">Page Activity</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(
              enriched.pageMetrics as Record<
                string,
                { count: number; avgMs: number; errors: number }
              >,
            )
              .sort(([, a], [, b]) => b.count - a.count)
              .slice(0, 8)
              .map(([path, m]) => (
                <div key={path} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground truncate max-w-[200px]">
                    {path}
                  </span>
                  <span>
                    {m.count} hits · {m.avgMs}ms avg{m.errors > 0 ? ` · ${m.errors} err` : ''}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {!runId && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card">
          Start a test from{' '}
          <Link to="/test-config" className="text-primary hover:underline">
            Test Config
          </Link>{' '}
          to see live metrics here.
        </div>
      )}
    </div>
  );
}
