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
        // WS URL resolution priority:
        //   1. VITE_WS_URL                  — explicit ws:// or wss:// override
        //   2. VITE_BACKEND_URL             — http(s)://host, converted to ws(s)://
        //   3. same-origin (window.location), protocol auto-matched to page
        //
        // On Vercel, set VITE_BACKEND_URL=https://traffic-forge.onrender.com
        // (Vite only exposes vars prefixed with VITE_ to the browser — NEXT_PUBLIC_*
        // does nothing in a Vite build.)
        const env = (import.meta as unknown as {
          env?: { VITE_WS_URL?: string; VITE_BACKEND_URL?: string };
        }).env;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let base: string;
        if (env?.VITE_WS_URL) {
          base = env.VITE_WS_URL.replace(/\/$/, '');
        } else if (env?.VITE_BACKEND_URL) {
          base = env.VITE_BACKEND_URL.replace(/\/$/, '').replace(/^http/, 'ws');
        } else {
          base = `${proto}//${window.location.host}`;
        }
        ws = new WebSocket(`${base}/ws/live-metrics?runId=${runId}`);

        ws.onopen = () => {
          setIsLive(true);
          reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.stats) {
              // Server sends requestsPerSec/avgResponseTime; map to local interface
              setStats({
                activeAgents: data.stats.activeAgents ?? 0,
                requestsPerSecond: data.stats.requestsPerSec ?? data.stats.requestsPerSecond ?? 0,
                errorRate: data.stats.errorRate ?? 0,
                avgResponse: data.stats.avgResponseTime ?? data.stats.avgResponse ?? 0,
                cpuPercent: data.stats.cpuPercent ?? 0,
                heapMB: data.stats.heapMB ?? 0,
                inFlightRequests: data.stats.inFlightRequests ?? 0,
              });
            }
            if (data.activity) setActivities((prev) => [data.activity, ...prev].slice(0, 100));
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
