/**
 * API client for the demo-app backend.
 * Connects to the real Express server which has intentional bugs injected.
 */

const BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : 'http://localhost:4000';

export interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  reactions: Record<string, number>;
}

export const api = {
  async list(): Promise<Message[]> {
    const res = await fetch(`${BASE}/messages`);
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return res.json();
  },

  async send(user: string, text: string): Promise<Message> {
    const res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error: string }).error ?? 'Send failed');
    }
    return res.json();
  },

  async react(messageId: string, emoji: string): Promise<void> {
    await fetch(`${BASE}/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  },

  subscribe(cb: (msg: Message) => void): () => void {
    const wsUrl = `${BASE.replace(/^http/, 'ws')}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as
          | { type: 'new_message'; message: Message }
          | { type: 'init'; messages: Message[] };

        if (data.type === 'new_message') cb(data.message);
      } catch {
        /* ignore parse errors */
      }
    };

    return () => ws.close();
  },
};
