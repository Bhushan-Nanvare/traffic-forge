import { cn } from '@/shared/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: number;
  color?: string;
}

export function StatCard({ label, value, icon, trend, color }: StatCardProps) {
  return (
    <div className={cn('rounded-lg border p-4', color || 'border-border bg-card')}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-2">{value}</p>
          {trend !== undefined && (
            <p className={cn('text-xs mt-2', trend > 0 ? 'text-green-600' : 'text-red-600')}>
              {trend > 0 ? '+' : ''}{trend}%
            </p>
          )}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
    </div>
  );
}
