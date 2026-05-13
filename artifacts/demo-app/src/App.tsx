import { useEffect, useState } from 'react';
import { api, type Message } from './api';

export default function App() {
  const [user, setUser] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;

    // Load initial messages
    api
      .list()
      .then(setMessages)
      .catch(() => setError('Failed to load messages'));

    // Subscribe to real-time updates (delayed due to intentional bug #3)
    const unsub = api.subscribe((msg) => {
      setMessages((prev) => {
        // BUG #1 companion: sort by timestamp — but timestamp jitter means order is wrong
        const next = [...prev, msg];
        return next.sort((a, b) => a.timestamp - b.timestamp);
      });
    });

    return () => unsub();
  }, [loggedIn]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await api.send(user, input);
      setInput('');
      // Reload list after send — will still show stale order due to bug #1
      const updated = await api.list();
      setMessages(updated);
    } catch (err) {
      // BUG #2 surfaces here — show the intentional persistence failure
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (msgId: string, emoji: string) => {
    try {
      await api.react(msgId, emoji);
      // Reload to see current reaction counts (may be wrong due to bug #4)
      const updated = await api.list();
      setMessages(updated);
    } catch {
      /* ignore */
    }
  };

  if (!loggedIn) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 480 }}>
        <h1 style={{ marginBottom: 8 }}>Demo Chat App</h1>
        <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
          This app has 5 intentional bugs. TrafficForge will detect them under concurrent load.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && user && setLoggedIn(true)}
            placeholder="Username"
            data-testid="username-input"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6 }}
          />
          <button
            onClick={() => user && setLoggedIn(true)}
            data-testid="login-button"
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 640 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Demo Chat — {user}</h1>
        <button
          onClick={() => setLoggedIn(false)}
          style={{
            fontSize: 12,
            color: '#666',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#dc2626',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 16,
          height: 400,
          overflowY: 'auto',
          background: '#f9fafb',
          marginBottom: 12,
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: '#9ca3af', textAlign: 'center', marginTop: 80 }}>No messages yet</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} data-testid="message" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{m.user}</strong>
                <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 8 }}>
                  {new Date(m.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ marginTop: 2 }}>{m.text}</div>
              <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                {['👍', '❤️', '😂'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReact(m.id, emoji)}
                    style={{
                      fontSize: 13,
                      background: 'none',
                      border: '1px solid #e5e7eb',
                      borderRadius: 4,
                      padding: '1px 6px',
                      cursor: 'pointer',
                    }}
                  >
                    {emoji} {m.reactions[emoji] ?? 0}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message…"
          data-testid="message-input"
          disabled={sending}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button
          onClick={handleSend}
          data-testid="send-button"
          disabled={sending || !input.trim()}
          style={{
            padding: '8px 16px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
