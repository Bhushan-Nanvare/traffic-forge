import { useSearchParams } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';

export default function AgentActivityViewer() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { activities, isLive } = useLiveData(runId);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Agent Activity Stream</h1>
        <span className="text-sm">
          {isLive ? <span className="text-success">● Live ({activities.length} events)</span> : <span className="text-muted-foreground">● Offline</span>}
        </span>
      </div>

      <div className="border rounded-lg bg-card divide-y">
        {activities.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p>No activity yet</p>
            <p className="text-xs mt-2">Start a test from Test Config to see agent activity here</p>
          </div>
        ) : (
          activities.map((activity, i) => (
            <div key={i} className="p-4 hover:bg-accent/30">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm font-semibold">{activity.name}</span>
                <span className="text-xs text-muted-foreground">{activity.time}</span>
              </div>
              <p className={`text-sm ${activity.type === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {activity.action}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
