import { useSearchParams } from 'react-router-dom';
import { useLiveData } from '@/shared/hooks/useLiveData';

export default function AgentActivityViewer() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const { activities } = useLiveData(runId);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Agent Activity</h1>
      <div className="space-y-2">
        {activities.map((activity, i) => (
          <div key={i} className="p-3 border rounded text-xs">
            <div className="flex justify-between">
              <span className="font-mono font-semibold">{activity.name}</span>
              <span className="text-muted-foreground">{activity.time}</span>
            </div>
            <p className="text-muted-foreground mt-1">{activity.action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
