import { useEffect, useRef } from 'react';

interface ActivityItem {
  id: string;
  name: string;
  action: string;
  time: string;
  type: 'info' | 'error' | 'warning';
}

interface ActivityFeedProps {
  items: ActivityItem[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 h-96 overflow-y-auto">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="text-xs py-2 border-b border-border/50 last:border-0">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-foreground">{item.name}</span>
              <span className="text-muted-foreground">{item.time}</span>
            </div>
            <p className="text-muted-foreground mt-1 truncate">{item.action}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
