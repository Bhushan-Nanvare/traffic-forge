import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import type { BugReport } from '@/features/test-results/TestResults';

const severityIcon = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
};

interface Props {
  report: BugReport;
  onClick: () => void;
}

export function BugCard({ report, onClick }: Props) {
  const Icon = severityIcon[report.bug.severity];
  return (
    <button
      onClick={onClick}
      className="w-full p-4 border rounded-lg text-left bg-card hover:brightness-110 transition"
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">{report.bug.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{report.bug.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{report.bug.type}</span>
            <span>{(report.bug.confidence * 100).toFixed(0)}% confidence</span>
          </div>
        </div>
      </div>
    </button>
  );
}
