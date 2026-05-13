import { X } from 'lucide-react';
import type { BugReport } from './TestResults';

interface Props {
  report: BugReport;
  onClose: () => void;
}

export default function BugDetail({ report, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-2xl p-6 w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {report.bug.severity}
            </span>
            <h2 className="text-xl font-bold mt-1">{report.bug.title}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{report.bug.description}</p>

        {report.rootCause && (
          <section className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Root Cause
            </h3>
            <p className="text-sm">{report.rootCause}</p>
          </section>
        )}

        {report.suggestedFix && (
          <section className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Suggested Fix
            </h3>
            <p className="text-sm">{report.suggestedFix}</p>
          </section>
        )}

        {report.reproductionSteps && (
          <section className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Reproduction Steps
            </h3>
            <ol className="list-decimal list-inside text-sm space-y-1">
              {report.reproductionSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
