import { useSearchParams } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { stats, isLive } = useLiveData(runId);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
      <div className="text-sm text-muted-foreground">
        {isLive ? '🔴 Live' : '⚫ Offline'} | Run: {runId || 'None'}
      </div>
      <div className="mt-6 grid grid-cols-4 gap-4">
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Active Agents</p>
          <p className="text-2xl font-bold">{stats.activeAgents}</p>
        </div>
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Requests/sec</p>
          <p className="text-2xl font-bold">{stats.requestsPerSecond.toFixed(1)}</p>
        </div>
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Avg Response</p>
          <p className="text-2xl font-bold">{stats.avgResponse}ms</p>
        </div>
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p className="text-2xl font-bold">{(stats.errorRate * 100).toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}
