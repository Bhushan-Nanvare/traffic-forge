export default function Analytics() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Analytics</h1>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Page Hits</p>
          <p className="text-2xl font-bold">0</p>
        </div>
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Avg Latency</p>
          <p className="text-2xl font-bold">0ms</p>
        </div>
        <div className="p-4 border rounded">
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold">0</p>
        </div>
      </div>
    </div>
  );
}
