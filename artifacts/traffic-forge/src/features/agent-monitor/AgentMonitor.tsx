import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';
import { Users, Activity, AlertTriangle } from 'lucide-react';

interface AgentInfo {
  id: number;
  userId: string;
  lastAction: string;
  status: 'active' | 'idle' | 'error';
  time: string;
}

export default function AgentMonitor() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { activities, isLive } = useLiveData(runId);
  const [filter, setFilter] = useState<'all' | 'active' | 'error'>('all');

  const agents = useMemo<AgentInfo[]>(() => {
    const map = new Map<string, any>();
    for (const a of activities) {
      if (!map.has(a.name)) map.set(a.name, a);
    }
    return Array.from(map.values()).map((a, i) => ({
      id: i + 1,
      userId: a.name,
      lastAction: a.action,
      status: a.type === 'error' ? 'error' : 'active',
      time: a.time,
    }));
  }, [activities]);

  const filtered = filter === 'all' ? agents : agents.filter((a) => a.status === filter);
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const errorCount = agents.filter((a) => a.status === 'error').length;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Agent Monitor</h1>
        <span className="text-sm">
          {isLive ? <span className="text-success">● Live</span> : <span className="text-muted-foreground">● Offline</span>}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <button
          onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}
          className={`p-4 border rounded-lg text-left ${filter === 'active' ? 'border-primary bg-primary/5' : 'bg-card'}`}
        >
          <Users className="w-5 h-5 mb-2" />
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-bold">{activeCount}</p>
        </button>
        <button
          onClick={() => setFilter(filter === 'error' ? 'all' : 'error')}
          className={`p-4 border rounded-lg text-left ${filter === 'error' ? 'border-destructive bg-destructive/5' : 'bg-card'}`}
        >
          <AlertTriangle className="w-5 h-5 mb-2" />
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold">{errorCount}</p>
        </button>
        <div className="p-4 border rounded-lg bg-card">
          <Activity className="w-5 h-5 mb-2" />
          <p className="text-xs text-muted-foreground">Total Agents</p>
          <p className="text-2xl font-bold">{agents.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {filtered.map((agent) => (
          <div key={agent.userId} className={`p-4 border rounded-lg ${agent.status === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card'}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                {agent.id}
              </div>
              <div>
                <p className="font-mono text-sm font-semibold">{agent.userId}</p>
                <p className="text-xs text-muted-foreground">{agent.time}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground truncate">{agent.lastAction}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
