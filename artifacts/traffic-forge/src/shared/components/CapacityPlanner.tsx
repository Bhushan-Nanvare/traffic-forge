import type { PredictionData } from '@/features/prediction/PredictionDashboard';

interface Props {
  data: PredictionData;
}

export function CapacityPlanner({ data }: Props) {
  const recommendations: string[] = [];

  if (data.predicted.cpuPercent > 80) {
    recommendations.push('Scale CPU capacity by 50%');
  }
  if (data.predicted.memoryMB > 2000) {
    recommendations.push('Increase memory allocation');
  }
  if (data.predicted.errorRate > 0.05) {
    recommendations.push('Investigate error sources before scaling');
  }
  if (data.failurePoint && data.failurePoint < data.targetAgentCount * 1.2) {
    recommendations.push('Critical: failure point near target capacity');
  }

  return (
    <div className="border rounded-lg p-4 bg-card">
      <h3 className="font-semibold mb-3">Capacity Recommendations</h3>
      {recommendations.length === 0 ? (
        <p className="text-sm text-muted-foreground">System is well-provisioned</p>
      ) : (
        <ul className="space-y-2">
          {recommendations.map((r, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-warning shrink-0">!</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
