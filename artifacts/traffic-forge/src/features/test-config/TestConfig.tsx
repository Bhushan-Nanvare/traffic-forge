import { useState, useId } from 'react';
import { useNavigate } from 'react-router-dom';

interface ScanResult {
  discoveredPaths: string[];
  pagesScanned: number;
  appType?: { detectedType: string; confidence: number };
}

export default function TestConfig() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [userCount, setUserCount] = useState(10);
  const [duration, setDuration] = useState(60);
  const [rampUp, setRampUp] = useState(5);
  const [testMode, setTestMode] = useState<'http' | 'browser' | 'both'>('http');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Stable IDs for label-to-input association (a11y)
  const urlId = useId();
  const userCountId = useId();
  const durationId = useId();
  const rampUpId = useId();
  const testModeId = useId();
  const statusId = useId();

  const handleScan = async () => {
    setError(null);
    setScanResult(null);
    try {
      setLoading(true);
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Scan failed (${response.status})`);
        return;
      }
      const data = (await response.json()) as ScanResult;
      setScanResult(data);
    } catch {
      setError('Network error during scan');
    } finally {
      setLoading(false);
    }
  };

  const handleStartTest = async () => {
    setError(null);
    try {
      setLoading(true);

      // Auto-scan if user hasn't already — without paths the load test only
      // hits "/" and misses every other route on the site.
      let paths = scanResult?.discoveredPaths;
      let appType = scanResult?.appType?.detectedType;
      if (!paths || paths.length === 0) {
        const scanRes = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (scanRes.ok) {
          const data = (await scanRes.json()) as ScanResult;
          paths = data.discoveredPaths;
          appType = data.appType?.detectedType;
          setScanResult(data);
        }
      }

      const configRes = await fetch('/api/test-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          user_count: userCount,
          duration_sec: duration,
          ramp_up_sec: rampUp,
          test_mode: testMode,
          discovered_paths: paths && paths.length > 0 ? paths : undefined,
          app_type: appType,
        }),
      });
      if (!configRes.ok) {
        setError('Failed to create test config');
        return;
      }
      const config = await configRes.json();

      const runRes = await fetch('/api/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id }),
      });
      const run = await runRes.json();

      await fetch(`/api/test-runs/${run.id}/start`, { method: 'POST' });

      navigate(`/dashboard?runId=${run.id}`);
    } catch {
      setError('Network error starting test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8" aria-labelledby="page-title">
      <h1 id="page-title" className="text-3xl font-bold mb-6">
        Test Configuration
      </h1>

      <form
        className="max-w-2xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          handleStartTest();
        }}
      >
        <div>
          <label htmlFor={urlId} className="block text-sm font-medium mb-2">
            Target URL
          </label>
          <input
            id={urlId}
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            aria-describedby={`${urlId}-help`}
            className="w-full px-4 py-2 border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p id={`${urlId}-help`} className="sr-only">
            Enter the full URL of the web application you want to load test
          </p>
          <button
            type="button"
            onClick={handleScan}
            disabled={!url || loading}
            className="mt-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {loading ? 'Scanning…' : 'Scan Site'}
          </button>

          {scanResult && (
            <div className="mt-3 p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm">
              <div className="font-medium mb-1">
                Scan complete — {scanResult.pagesScanned} pages,{' '}
                {scanResult.discoveredPaths.length} paths
                {scanResult.appType?.detectedType
                  ? ` • detected as ${scanResult.appType.detectedType}`
                  : ''}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {scanResult.discoveredPaths.map((p) => (
                  <span
                    key={p}
                    className="px-2 py-0.5 bg-card border rounded text-xs font-mono"
                  >
                    {p}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                These paths will be tested when you start the run.
              </p>
            </div>
          )}
        </div>

        <fieldset className="border-t pt-6">
          <legend className="text-lg font-semibold mb-4">Test Settings</legend>

          <div className="space-y-4">
            <div>
              <label htmlFor={userCountId} className="block text-sm font-medium mb-2">
                User Count: <span aria-live="polite">{userCount}</span>
              </label>
              <input
                id={userCountId}
                type="range"
                min={1}
                max={500}
                value={userCount}
                aria-valuemin={1}
                aria-valuemax={500}
                aria-valuenow={userCount}
                onChange={(e) => setUserCount(parseInt(e.target.value, 10))}
                className="w-full focus:outline-none focus:ring-2 focus:ring-primary rounded"
              />
            </div>

            <div>
              <label htmlFor={durationId} className="block text-sm font-medium mb-2">
                Duration (seconds): <span aria-live="polite">{duration}</span>
              </label>
              <input
                id={durationId}
                type="range"
                min={10}
                max={600}
                value={duration}
                aria-valuemin={10}
                aria-valuemax={600}
                aria-valuenow={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                className="w-full focus:outline-none focus:ring-2 focus:ring-primary rounded"
              />
            </div>

            <div>
              <label htmlFor={rampUpId} className="block text-sm font-medium mb-2">
                Ramp-up (seconds): <span aria-live="polite">{rampUp}</span>
              </label>
              <input
                id={rampUpId}
                type="range"
                min={1}
                max={60}
                value={rampUp}
                aria-valuemin={1}
                aria-valuemax={60}
                aria-valuenow={rampUp}
                onChange={(e) => setRampUp(parseInt(e.target.value, 10))}
                className="w-full focus:outline-none focus:ring-2 focus:ring-primary rounded"
              />
            </div>

            <div>
              <label htmlFor={testModeId} className="block text-sm font-medium mb-2">
                Test Mode
              </label>
              <select
                id={testModeId}
                value={testMode}
                onChange={(e) => setTestMode(e.target.value as 'http' | 'browser' | 'both')}
                className="w-full px-4 py-2 border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="http">HTTP Requests Only</option>
                <option value="browser">Browser Simulation</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
        </fieldset>

        {error && (
          <div
            role="alert"
            id={statusId}
            className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!url || loading}
          aria-describedby={error ? statusId : undefined}
          className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          {loading ? 'Starting…' : 'Start Test'}
        </button>
      </form>
    </main>
  );
}
