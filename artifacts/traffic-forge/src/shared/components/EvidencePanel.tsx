interface Props {
  evidence: { source: string; description: string; weight: number }[];
}

export function EvidencePanel({ evidence }: Props) {
  if (evidence.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-card text-sm text-muted-foreground">
        No evidence collected
      </div>
    );
  }
  return (
    <div className="border rounded-lg p-4 bg-card space-y-2">
      {evidence.map((e, i) => (
        <div key={i} className="text-sm">
          <span className="text-xs font-mono uppercase text-muted-foreground mr-2">{e.source}</span>
          <span>{e.description}</span>
          <span className="text-xs text-muted-foreground ml-2">
            (weight {(e.weight * 100).toFixed(0)}%)
          </span>
        </div>
      ))}
    </div>
  );
}
