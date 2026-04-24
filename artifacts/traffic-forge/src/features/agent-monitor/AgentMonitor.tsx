import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';

export default function AgentMonitor() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { activities } = useLiveData(runId);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Agent Monitor</h1>
      <div className="grid grid-cols-4 gap-4">
        {activities.slice(0, 8).map((activity, i) => (
          <div key={i} className="p-4 border rounded">
            <p className="font-mono text-xs">{activity.name}</p>
            <p className="text-xs text-muted-foreground mt-2 truncate">{activity.action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
