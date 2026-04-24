import { Link } from 'react-router-dom';
import { Activity, Zap, Shield, BarChart3 } from 'lucide-react';

export default function Overview() {
  const features = [
    { icon: Zap, title: 'Lightning Fast', desc: 'Concurrent HTTP load testing with thousands of virtual users' },
    { icon: Shield, title: 'Smart Detection', desc: 'Site scanner discovers pages, forms, and app patterns automatically' },
    { icon: Activity, title: 'Live Monitoring', desc: 'Real-time WebSocket metrics streamed every 500ms' },
    { icon: BarChart3, title: 'Deep Analytics', desc: 'P50/P95/P99 percentiles, error breakdown, and page-level metrics' },
  ];

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-12">
        <h1 className="text-5xl font-bold mb-4">TrafficForge</h1>
        <p className="text-xl text-muted-foreground">Intelligent Load Testing Platform</p>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          Test your web applications with smart agents that understand what your app does.
          Find bugs, bottlenecks, and performance issues before your users do.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-12">
        {features.map((f) => (
          <div key={f.title} className="p-6 border rounded-lg bg-card">
            <f.icon className="w-8 h-8 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-4">
        <Link
          to="/test-config"
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90"
        >
          Start Testing
        </Link>
        <Link
          to="/reports"
          className="px-6 py-3 border rounded-lg font-medium hover:bg-accent"
        >
          View Reports
        </Link>
      </div>
    </div>
  );
}
