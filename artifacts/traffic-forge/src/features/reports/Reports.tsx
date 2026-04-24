import { useQuery } from '@tanstack/react-query';

interface TestRun {
  id: string;
  created_at: string;
  duration_sec: number;
  status: string;
  passed: boolean | null;
  config?: { user_count: number };
  metrics?: { total_requests: number; error_rate: number };
}

export default function Reports() {
  const { data: runs = [], refetch } = useQuery<TestRun[]>({
    queryKey: ['test-runs'],
    queryFn: async () => {
      const res = await fetch('/api/test-runs');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const handleDelete = async (runId: string) => {
    try {
      await fetch(`/api/test-runs/${runId}/cleanup`, { method: 'DELETE' });
      refetch();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const validRuns = runs.filter((r) => r.created_at);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Test Reports</h1>

      <div className="border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="text-left p-4">Date</th>
              <th className="text-left p-4">Duration</th>
              <th className="text-left p-4">Users</th>
              <th className="text-left p-4">Requests</th>
              <th className="text-left p-4">Error Rate</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {validRuns.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No test runs yet
                </td>
              </tr>
            ) : (
              validRuns.map((run) => (
                <tr key={run.id} className="border-b hover:bg-accent/30">
                  <td className="p-4 text-xs">{new Date(run.created_at).toLocaleDateString()}</td>
                  <td className="p-4 text-xs">{run.duration_sec}s</td>
                  <td className="p-4 text-xs">{run.config?.user_count ?? '-'}</td>
                  <td className="p-4 text-xs">{run.metrics?.total_requests ?? '-'}</td>
                  <td className="p-4 text-xs">{((run.metrics?.error_rate ?? 0) * 100).toFixed(1)}%</td>
                  <td className="p-4 text-xs">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-muted text-foreground">
                      {run.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <button onClick={() => handleDelete(run.id)} className="text-xs text-destructive hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
