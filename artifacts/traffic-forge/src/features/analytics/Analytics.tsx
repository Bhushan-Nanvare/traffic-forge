import { useEffect, useState } from 'react';

interface PageMetric {
  path: string;
  count: number;
  avgMs: number;
  errors: number;
}

export default function Analytics() {
  const [metrics, setMetrics] = useState<PageMetric[]>([]);

  useEffect(() => {
    setMetrics([
      { path: '/', count: 1250, avgMs: 145, errors: 12 },
      { path: '/api/users', count: 890, avgMs: 210, errors: 5 },
      { path: '/api/posts', count: 756, avgMs: 320, errors: 8 },
      { path: '/dashboard', count: 445, avgMs: 95, errors: 2 },
      { path: '/api/upload', count: 123, avgMs: 1200, errors: 23 },
    ]);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Analytics</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Total Requests</p>
          <p className="text-2xl font-bold">3,464</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Avg Response</p>
          <p className="text-2xl font-bold">354ms</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Total Errors</p>
          <p className="text-2xl font-bold">50</p>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p className="text-2xl font-bold">1.44%</p>
        </div>
      </div>

      <div className="border rounded-lg bg-card p-4">
        <h2 className="font-semibold mb-4">Page Metrics</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left p-3">Path</th>
              <th className="text-right p-3">Hits</th>
              <th className="text-right p-3">Avg (ms)</th>
              <th className="text-right p-3">Errors</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.path} className="border-b hover:bg-accent/50">
                <td className="p-3 font-mono text-xs">{m.path}</td>
                <td className="p-3 text-right">{m.count}</td>
                <td className="p-3 text-right">{m.avgMs}</td>
                <td className="p-3 text-right">{m.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
