import { useState } from 'react';

export default function TestConfig() {
  const [url, setUrl] = useState('');

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
            className="w-full px-4 py-2 border rounded-lg"
          />
        </div>
        <button className="px-6 py-2 bg-primary text-primary-foreground rounded-lg">
          Scan Site
        </button>
      </div>
    </div>
  );
}
