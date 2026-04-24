import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function TestConfig() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [userCount, setUserCount] = useState(10);
  const [duration, setDuration] = useState(60);
  const [rampUp, setRampUp] = useState(5);
  const [testMode, setTestMode] = useState<'http' | 'browser' | 'both'>('http');
  const [loading, setLoading] = useState(false);

  const handleScan = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (response.ok) {
        const data = await response.json();
        console.log('Scan complete:', data);
      }
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartTest = async () => {
    try {
      setLoading(true);
      const configRes = await fetch('/api/test-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          user_count: userCount,
          duration_sec: duration,
          ramp_up_sec: rampUp,
          test_mode: testMode,
        }),
      });
      const config = await configRes.json();

      const runRes = await fetch('/api/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id }),
      });
      const run = await runRes.json();

      await fetch(`/api/test-runs/${run.id}/start`, { method: 'POST' });

      navigate(`/dashboard?runId=${run.id}`);
    } catch (error) {
      console.error('Test start failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Test Configuration</h1>
      <div className="max-w-2xl space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Target URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-4 py-2 border rounded-lg bg-card text-foreground"
          />
          <button
            onClick={handleScan}
            disabled={!url || loading}
            className="mt-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg disabled:opacity-50"
          >
            {loading ? 'Scanning...' : 'Scan Site'}
          </button>
        </div>

        <div className="border-t pt-6">
          <h2 className="text-lg font-semibold mb-4">Test Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                User Count: {userCount}
              </label>
              <input
                type="range"
                min="1"
                max="500"
                value={userCount}
                onChange={(e) => setUserCount(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Duration (seconds): {duration}
              </label>
              <input
                type="range"
                min="10"
                max="600"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Ramp-up (seconds): {rampUp}
              </label>
              <input
                type="range"
                min="1"
                max="60"
                value={rampUp}
                onChange={(e) => setRampUp(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Test Mode</label>
              <select
                value={testMode}
                onChange={(e) => setTestMode(e.target.value as 'http' | 'browser' | 'both')}
                className="w-full px-4 py-2 border rounded-lg bg-card text-foreground"
              >
                <option value="http">HTTP Requests Only</option>
                <option value="browser">Browser Simulation</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={handleStartTest}
          disabled={!url || loading}
          className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Test'}
        </button>
      </div>
    </div>
  );
}
