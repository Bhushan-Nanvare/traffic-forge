interface HeatmapCell {
  label: string;
  value: number;
  max: number;
}

interface Props {
  cells: HeatmapCell[];
}

export function HeatmapView({ cells }: Props) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {cells.map((c) => {
        const intensity = c.value / Math.max(c.max, 1);
        const opacity = Math.max(0.1, intensity);
        return (
          <div
            key={c.label}
            className="aspect-square rounded text-xs flex items-center justify-center text-foreground"
            style={{ backgroundColor: 'rgba(239, 68, 68, ' + opacity + ')' }}
            title={c.label + ': ' + c.value}
          >
            {c.label.slice(0, 2)}
          </div>
        );
      })}
    </div>
  );
}
