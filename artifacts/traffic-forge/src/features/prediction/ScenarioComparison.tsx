import type { PredictionData } from './PredictionDashboard';

interface Props {
  data: PredictionData;
}

export function ScenarioComparison({ data }: Props) {
  const scenarios = [
    { name: 'Best case', factor: 0.7 },
    { name: 'Expected', factor: 1.0 },
    { name: 'Worst case', factor: 1.5 },
  ];

  return (
    <div className="border rounded-lg p-4 bg-card">
      <h3 className="font-semibold mb-3">What-If Scenarios</h3>
      <div className="space-y-3">
        {scenarios.map((s) => (
          <div
            key={s.name}
            className="flex justify-between items-center pb-3 border-b last:border-0"
          >
            <span className="text-sm">{s.name}</span>
            <span className="text-sm font-mono">
              {(data.predicted.avgResponseMs * s.factor).toFixed(0)}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
