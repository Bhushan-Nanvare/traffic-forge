import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function PerformanceChart() {
  const data = Array.from({ length: 30 }).map((_, i) => ({
    time: i,
    p50: 100 + Math.random() * 50,
    p95: 200 + Math.random() * 200,
    p99: 400 + Math.random() * 400,
  }));

  return (
    <div className="border rounded-lg p-4 bg-card">
      <h3 className="font-semibold mb-3">Latency Over Time</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="p50" stroke="#10b981" strokeWidth={2} />
          <Line type="monotone" dataKey="p95" stroke="#f59e0b" strokeWidth={2} />
          <Line type="monotone" dataKey="p99" stroke="#ef4444" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
