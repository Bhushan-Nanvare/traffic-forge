import { useState, useEffect } from 'react';

export interface MetricsData {
  activeAgents: number;
  requestsPerSecond: number;
  errorRate: number;
  avgResponse: number;
  cpuPercent: number;
  heapMB: number;
  inFlightRequests: number;
}

export interface Activity {
  name: string;
  action: string;
  time: string;
  type: 'info' | 'error' | 'warning';
}

export interface LiveDataReturn {
  stats: MetricsData;
  activities: Activity[];
  enriched: any;
  isLive: boolean;
}

export function useLiveData(runId: string | null): LiveDataReturn {
  const [stats, setStats] = useState<MetricsData>({
    activeAgents: 0,
    requestsPerSecond: 0,
    errorRate: 0,
    avgResponse: 0,
    cpuPercent: 0,
    heapMB: 0,
    inFlightRequests: 0,
  });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [enriched, setEnriched] = useState<any>(null);

  useEffect(() => {
    if (!runId) return;

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    const maxAttempts = 5;

    const connect = () => {
      try {
        ws = new WebSocket(`ws://${window.location.host}/ws?runId=${runId}`);

        ws.onopen = () => {
          setIsLive(true);
          reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.stats) setStats(data.stats);
            if (data.activities) setActivities(data.activities);
            if (data.enriched) setEnriched(data.enriched);
          } catch (err) {
            console.error('Failed to parse message:', err);
          }
        };

        ws.onerror = () => {
          setIsLive(false);
        };

        ws.onclose = () => {
          setIsLive(false);
          if (reconnectAttempts < maxAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            setTimeout(() => {
              reconnectAttempts++;
              connect();
            }, delay);
          }
        };
      } catch (err) {
        console.error('WebSocket connection error:', err);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
    };
  }, [runId]);

  return { stats, activities, enriched, isLive };
}
