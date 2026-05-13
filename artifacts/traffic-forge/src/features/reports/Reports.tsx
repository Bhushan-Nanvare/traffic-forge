import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Brain,
  Trash2,
  ExternalLink,
  RefreshCw,
  Zap,
  Globe,
  Wifi,
  Terminal,
  Navigation,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  FileJson,
  FileText,
} from 'lucide-react';

// ─── Shared types ─────────────────────────────────────────────────────────────

type FailureSeverity = 'crash' | 'http_error' | 'network' | 'console_error' | 'navigation_failure' | 'slow';

interface ConsoleEntry { level: string; text: string }
interface NetworkEntry { url: string; method: string; status: number | null; failed: boolean; failureReason?: string }
interface StepEvidence {
  screenshotBefore: string | null;
  screenshotAfter: string | null;
  urlBefore: string;
  urlAfter?: string;
  domSnapshotBefore?: string | null;
  domSnapshotAfter?: string | null;
  consoleLogs: ConsoleEntry[];
  networkRequests: NetworkEntry[];
  domMutated?: boolean;
}
interface DetectedFailure {
  type: FailureSeverity;
  message: string;
  fingerprint: string;
  elementText: string;
  stepIndex: number;
  evidence: StepEvidence;
  llmNarrative?: { cause: string; fix: string; model: string };
}
interface SwarmRunSummary {
  runId: string;
  targetUrl: string;
  totalSteps: number;
  uniqueBugs: number;
  severityCounts: Record<FailureSeverity, number>;
  steps: Array<{ index: number; elementText: string; failures: DetectedFailure[] }>;
  failures: DetectedFailure[];
  durationMs: number;
  startedAt: number;
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<FailureSeverity, string> = {
  crash: 'text-red-500',
  http_error: 'text-orange-500',
  network: 'text-yellow-500',
  console_error: 'text-amber-500',
  navigation_failure: 'text-purple-500',
  slow: 'text-blue-400',
};

const SEVERITY_BG: Record<FailureSeverity, string> = {
  crash: 'bg-red-500/10 border-red-500/30',
  http_error: 'bg-orange-500/10 border-orange-500/30',
  network: 'bg-yellow-500/10 border-yellow-500/30',
  console_error: 'bg-amber-500/10 border-amber-500/30',
  navigation_failure: 'bg-purple-500/10 border-purple-500/30',
  slow: 'bg-blue-500/10 border-blue-500/30',
};

const SEVERITY_LABEL: Record<FailureSeverity, string> = {
  crash: 'JS CRASH',
  http_error: 'HTTP ERROR',
  network: 'NETWORK',
  console_error: 'CONSOLE ERR',
  navigation_failure: 'NAV FAILURE',
  slow: 'SLOW',
};

const SEVERITY_ICON: Record<FailureSeverity, React.ReactNode> = {
  crash: <Zap className="w-3.5 h-3.5" />,
  http_error: <Globe className="w-3.5 h-3.5" />,
  network: <Wifi className="w-3.5 h-3.5" />,
  console_error: <Terminal className="w-3.5 h-3.5" />,
  navigation_failure: <Navigation className="w-3.5 h-3.5" />,
  slow: <MinusCircle className="w-3.5 h-3.5" />,
};

const SEVERITY_ORDER: FailureSeverity[] = ['crash', 'http_error', 'network', 'console_error', 'navigation_failure', 'slow'];

// ─── Swarm Bug Card ───────────────────────────────────────────────────────────

function BugCard({ failure }: { failure: DetectedFailure }) {
  const [open, setOpen] = useState<null | 'screenshots' | 'console' | 'network' | 'dom'>(null);
  const toggle = (key: typeof open) => setOpen(open === key ? null : key);
  const consoleErrors = failure.evidence.consoleLogs.filter((l) => l.level === 'error');
  const networkErrors = failure.evidence.networkRequests.filter(
    (r) => r.failed || (r.status != null && r.status >= 400),
  );
  const hasDom = !!(failure.evidence.domSnapshotBefore || failure.evidence.domSnapshotAfter);

  return (
    <div className={`border rounded-xl p-4 mb-3 ${SEVERITY_BG[failure.type]}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border ${SEVERITY_BG[failure.type]} ${SEVERITY_COLOR[failure.type]}`}>
            {SEVERITY_ICON[failure.type]} {SEVERITY_LABEL[failure.type]}
          </span>
          <span className="text-sm font-medium">
            "{failure.elementText || 'unknown element'}"
          </span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">step #{failure.stepIndex + 1}</span>
      </div>

      {/* Error message */}
      <p className="text-sm text-foreground/90 mb-2">{failure.message}</p>

      {/* LLM narrative */}
      {failure.llmNarrative && (
        <div className="border border-border/50 rounded-lg p-3 bg-background/40 mb-3 space-y-1.5">
          <p className="text-xs">
            <span className="text-muted-foreground font-medium">Why: </span>
            {failure.llmNarrative.cause}
          </p>
          <p className="text-xs">
            <span className="text-muted-foreground font-medium">Fix: </span>
            {failure.llmNarrative.fix}
          </p>
          <p className="text-[10px] text-muted-foreground">via {failure.llmNarrative.model}</p>
        </div>
      )}

      {/* URL context */}
      <p className="text-xs text-muted-foreground font-mono mb-3 truncate">{failure.evidence.urlBefore}</p>

      {/* Evidence accordion */}
      <div className="space-y-1">
        {(failure.evidence.screenshotBefore || failure.evidence.screenshotAfter) && (
          <div>
            <button
              onClick={() => toggle('screenshots')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open === 'screenshots' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Screenshots
            </button>
            {open === 'screenshots' && (
              <div className="flex gap-2 mt-2">
                {failure.evidence.screenshotBefore && (
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1">Before</p>
                    <img
                      src={`data:image/png;base64,${failure.evidence.screenshotBefore}`}
                      alt="before"
                      className="w-full rounded border border-border"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {consoleErrors.length > 0 && (
          <div>
            <button
              onClick={() => toggle('console')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open === 'console' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Console ({consoleErrors.length} error{consoleErrors.length !== 1 ? 's' : ''})
            </button>
            {open === 'console' && (
              <div className="mt-2 bg-black/40 rounded p-2 font-mono text-xs space-y-1 max-h-32 overflow-y-auto">
                {consoleErrors.map((l, i) => (
                  <div key={i} className="text-red-400">{l.text}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {networkErrors.length > 0 && (
          <div>
            <button
              onClick={() => toggle('network')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open === 'network' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Network ({networkErrors.length} failure{networkErrors.length !== 1 ? 's' : ''})
            </button>
            {open === 'network' && (
              <div className="mt-2 bg-black/40 rounded p-2 font-mono text-xs space-y-1 max-h-32 overflow-y-auto">
                {networkErrors.map((r, i) => (
                  <div key={i} className="text-red-400">
                    {r.method} {r.url.slice(0, 80)} → {r.status ?? 'FAILED'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasDom && (
          <div>
            <button
              onClick={() => toggle('dom')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open === 'dom' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              DOM diff {failure.evidence.domMutated ? '(mutated)' : '(unchanged)'}
            </button>
            {open === 'dom' && <DomDiffView evidence={failure.evidence} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DOM Diff View ────────────────────────────────────────────────────────────

function DomDiffView({ evidence }: { evidence: StepEvidence }) {
  const [mode, setMode] = useState<'before' | 'after' | 'diff'>('diff');
  const before = evidence.domSnapshotBefore ?? '';
  const after = evidence.domSnapshotAfter ?? '';

  // Naive line-level diff — fast enough for snapshots truncated to 50KB.
  const diffLines = useMemo(() => {
    if (!before && !after) return [] as Array<{ kind: '+' | '-' | '='; text: string }>;
    const beforeLines = new Set(before.split('\n'));
    const afterLines = new Set(after.split('\n'));
    const out: Array<{ kind: '+' | '-' | '='; text: string }> = [];
    for (const line of after.split('\n')) {
      if (!beforeLines.has(line)) out.push({ kind: '+', text: line });
    }
    for (const line of before.split('\n')) {
      if (!afterLines.has(line)) out.push({ kind: '-', text: line });
    }
    return out.slice(0, 200);
  }, [before, after]);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {(['diff', 'before', 'after'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${mode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="bg-black/40 rounded p-2 font-mono text-[11px] max-h-64 overflow-auto">
        {mode === 'diff' ? (
          diffLines.length === 0 ? (
            <div className="text-muted-foreground">No differences detected</div>
          ) : (
            diffLines.map((l, i) => (
              <div
                key={i}
                className={
                  l.kind === '+' ? 'text-green-400' : l.kind === '-' ? 'text-red-400' : 'text-muted-foreground'
                }
              >
                {l.kind} {l.text.slice(0, 200)}
              </div>
            ))
          )
        ) : (
          <pre className="text-muted-foreground whitespace-pre-wrap break-all">
            {(mode === 'before' ? before : after).slice(0, 10_000) || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function summaryToMarkdown(summary: SwarmRunSummary): string {
  const lines: string[] = [];
  lines.push(`# Swarm Bug Report`);
  lines.push('');
  lines.push(`- **Target:** ${summary.targetUrl}`);
  lines.push(`- **Run ID:** ${summary.runId}`);
  lines.push(`- **Started:** ${new Date(summary.startedAt).toISOString()}`);
  lines.push(`- **Steps:** ${summary.totalSteps}`);
  lines.push(`- **Unique bugs:** ${summary.uniqueBugs}`);
  lines.push(`- **Duration:** ${(summary.durationMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push(`## Severity breakdown`);
  for (const [type, count] of Object.entries(summary.severityCounts)) {
    if (count > 0) lines.push(`- ${type}: ${count}`);
  }
  lines.push('');
  lines.push(`## Bugs`);
  lines.push('');

  for (const f of summary.failures) {
    lines.push(`### [${f.type.toUpperCase()}] ${f.elementText || f.fingerprint}`);
    lines.push('');
    lines.push(`- **Fingerprint:** \`${f.fingerprint}\``);
    lines.push(`- **Step:** #${f.stepIndex + 1}`);
    lines.push(`- **URL:** ${f.evidence.urlBefore}`);
    lines.push('');
    lines.push(`**Error:** ${f.message}`);
    lines.push('');
    if (f.llmNarrative) {
      lines.push(`**Why:** ${f.llmNarrative.cause}`);
      lines.push('');
      lines.push(`**Fix:** ${f.llmNarrative.fix}`);
      lines.push('');
      lines.push(`*(narrative by ${f.llmNarrative.model})*`);
      lines.push('');
    }
    const consoleErrors = f.evidence.consoleLogs.filter((l) => l.level === 'error');
    if (consoleErrors.length > 0) {
      lines.push(`**Console errors:**`);
      lines.push('```');
      for (const c of consoleErrors.slice(0, 10)) lines.push(c.text);
      lines.push('```');
      lines.push('');
    }
    const networkErrors = f.evidence.networkRequests.filter(
      (r) => r.failed || (r.status != null && r.status >= 400),
    );
    if (networkErrors.length > 0) {
      lines.push(`**Network errors:**`);
      lines.push('```');
      for (const n of networkErrors.slice(0, 10)) {
        lines.push(`${n.method} ${n.url} → ${n.status ?? 'FAILED'}`);
      }
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Swarm Run Card ───────────────────────────────────────────────────────────

function SwarmRunCard({ summary }: { summary: SwarmRunSummary }) {
  const [severityFilter, setSeverityFilter] = useState<FailureSeverity | 'all'>('all');
  const filtered = severityFilter === 'all'
    ? summary.failures
    : summary.failures.filter((f) => f.type === severityFilter);

  const present = SEVERITY_ORDER.filter((s) => (summary.severityCounts[s] ?? 0) > 0);

  const exportJson = () => downloadFile(
    `swarm-${summary.runId.slice(0, 8)}.json`,
    'application/json',
    JSON.stringify(summary, null, 2),
  );

  const exportMarkdown = () => downloadFile(
    `swarm-${summary.runId.slice(0, 8)}.md`,
    'text/markdown',
    summaryToMarkdown(summary),
  );

  return (
    <div className="border border-border rounded-xl bg-card mb-4 overflow-hidden">
      {/* Run header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-1 gap-3">
          <p className="font-mono text-sm text-muted-foreground truncate">{summary.targetUrl}</p>
          <div className="flex items-center gap-2 shrink-0">
            <p className="text-xs text-muted-foreground">
              {new Date(summary.startedAt).toLocaleString()}
            </p>
            <button
              onClick={exportJson}
              title="Export as JSON"
              aria-label="Export as JSON"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground"
            >
              <FileJson className="w-3 h-3" /> JSON
            </button>
            <button
              onClick={exportMarkdown}
              title="Export as Markdown"
              aria-label="Export as Markdown"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground"
            >
              <FileText className="w-3 h-3" /> Markdown
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span>{summary.totalSteps} steps</span>
          <span className="text-muted-foreground">•</span>
          <span className={summary.uniqueBugs > 0 ? 'text-red-400' : 'text-green-400'}>
            {summary.uniqueBugs} unique bug{summary.uniqueBugs !== 1 ? 's' : ''}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{(summary.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {summary.failures.length === 0 ? (
        <div className="p-6 text-center text-sm text-green-400">No failures detected</div>
      ) : (
        <div className="p-4">
          {/* Severity filter tabs */}
          {present.length > 1 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button
                onClick={() => setSeverityFilter('all')}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${severityFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                All ({summary.failures.length})
              </button>
              {present.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverityFilter(s)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${severityFilter === s ? `${SEVERITY_BG[s]} ${SEVERITY_COLOR[s]} border-current` : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {SEVERITY_ICON[s]} {SEVERITY_LABEL[s]} ({summary.severityCounts[s]})
                </button>
              ))}
            </div>
          )}

          {/* Bug cards */}
          {filtered.map((f) => (
            <BugCard key={f.fingerprint} failure={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Swarm Runs Tab ───────────────────────────────────────────────────────────

function SwarmReportsTab() {
  const { data: allRuns = [], isLoading } = useQuery<
    Array<{ runId: string; status: string; summary?: SwarmRunSummary; startedAt?: number }>
  >({
    queryKey: ['swarm-runs-list'],
    queryFn: async () => {
      // We don't have a list endpoint, so we load from localStorage-persisted IDs
      const ids: string[] = JSON.parse(localStorage.getItem('swarm_run_ids') ?? '[]');
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/swarm-runs/${id}`).then((r) => (r.ok ? r.json() : null)),
        ),
      );
      return results
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter(Boolean);
    },
    refetchInterval: 3000,
  });

  const done = allRuns.filter((r) => r.status === 'done' && r.summary);
  const running = allRuns.filter((r) => r.status === 'running');

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <RefreshCw className="inline w-4 h-4 mr-2 animate-spin" /> Loading…
      </div>
    );
  }

  if (allRuns.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        No swarm runs yet.{' '}
        <Link to="/agent-monitor" className="text-primary hover:underline">
          Launch a swarm agent
        </Link>
      </div>
    );
  }

  return (
    <div>
      {running.length > 0 && (
        <div className="mb-4 border border-green-500/30 bg-green-500/5 rounded-lg p-3 text-sm text-green-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {running.length} swarm run{running.length !== 1 ? 's' : ''} in progress
        </div>
      )}
      {done.map((r) => r.summary && <SwarmRunCard key={r.runId} summary={r.summary} />)}
    </div>
  );
}

// ─── Load Test Table (preserved from before) ─────────────────────────────────

interface TestRun {
  id: string;
  created_at: string;
  status: string;
  passed: boolean | null;
  total_requests: number | null;
  error_rate: number | null;
  avg_response_ms: number | null;
  p95_ms: number | null;
  user_count: number | null;
}

interface AnalysisStatus {
  status: 'pending' | 'running' | 'complete' | 'error';
  bugs?: { bug: { severity: 'high' | 'medium' | 'low' } }[];
  cost?: { estimatedUsd: number };
}

function StatusBadge({ status, passed }: { status: string; passed: boolean | null }) {
  const color =
    status === 'completed' && passed
      ? 'bg-green-500/20 text-green-700 dark:text-green-400'
      : status === 'completed' && !passed
        ? 'bg-red-500/20 text-red-700 dark:text-red-400'
        : status === 'running'
          ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
          : 'bg-muted text-muted-foreground';
  return <span className={`px-2 py-1 rounded text-xs font-medium ${color}`}>{status}</span>;
}

function RunRow({ run, onDelete }: { run: TestRun; onDelete: (id: string) => void }) {
  const queryClient = useQueryClient();

  const { data: analysis } = useQuery<AnalysisStatus>({
    queryKey: ['analysis', run.id],
    queryFn: async () => {
      const res = await fetch(`/api/test-runs/${run.id}/analysis`);
      if (!res.ok) return { status: 'pending' as const };
      return res.json();
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'pending' ? 3000 : false;
    },
    enabled: run.status === 'completed',
  });

  const triggerAnalysis = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/test-runs/${run.id}/analyze`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analysis', run.id] }),
  });

  const highBugs = analysis?.bugs?.filter((b) => b.bug.severity === 'high').length ?? 0;
  const totalBugs = analysis?.bugs?.length ?? 0;
  const isAnalyzing = analysis?.status === 'running' || triggerAnalysis.isPending;

  return (
    <tr className="border-b hover:bg-accent/30">
      <td className="p-4 text-xs text-muted-foreground">
        {new Date(run.created_at).toLocaleDateString()}{' '}
        {new Date(run.created_at).toLocaleTimeString()}
      </td>
      <td className="p-4 text-xs">{run.user_count ?? '-'}</td>
      <td className="p-4 text-xs">{run.total_requests?.toLocaleString() ?? '-'}</td>
      <td className="p-4 text-xs">
        {run.error_rate != null ? `${run.error_rate.toFixed(1)}%` : '-'}
      </td>
      <td className="p-4 text-xs">
        {run.avg_response_ms != null ? `${run.avg_response_ms.toFixed(0)}ms` : '-'}
        {run.p95_ms ? <span className="text-muted-foreground"> / {run.p95_ms}ms p95</span> : ''}
      </td>
      <td className="p-4">
        <StatusBadge status={run.status} passed={run.passed} />
      </td>
      <td className="p-4 text-xs">
        {analysis?.status === 'complete' ? (
          <Link
            to={`/results?runId=${run.id}`}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {totalBugs} issue{totalBugs !== 1 ? 's' : ''}
            {highBugs > 0 && <span className="text-destructive">({highBugs} high)</span>}
            <ExternalLink className="w-3 h-3" />
          </Link>
        ) : isAnalyzing ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" /> Analyzing…
          </span>
        ) : run.status === 'completed' ? (
          <button
            onClick={() => triggerAnalysis.mutate()}
            className="flex items-center gap-1 text-primary hover:underline text-xs"
          >
            <Brain className="w-3 h-3" /> Analyze
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-4">
        <button
          onClick={() => onDelete(run.id)}
          className="text-destructive hover:text-destructive/70 focus:outline-none focus:ring-2 focus:ring-destructive rounded p-1"
          title="Delete run"
          aria-label={`Delete test run ${run.id.slice(0, 8)}`}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function LoadTestReportsTab() {
  const queryClient = useQueryClient();

  const { data: runs = [], isLoading } = useQuery<TestRun[]>({
    queryKey: ['test-runs'],
    queryFn: async () => {
      const res = await fetch('/api/test-runs');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const deleteRun = useMutation({
    mutationFn: async (runId: string) => {
      await fetch(`/api/test-runs/${runId}/cleanup`, { method: 'POST' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-runs'] }),
  });

  const validRuns = runs.filter((r) => r.created_at);

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-muted-foreground">
            <th className="text-left p-4">Date</th>
            <th className="text-left p-4">Users</th>
            <th className="text-left p-4">Requests</th>
            <th className="text-left p-4">Error Rate</th>
            <th className="text-left p-4">Response Time</th>
            <th className="text-left p-4">Status</th>
            <th className="text-left p-4">AI Analysis</th>
            <th className="text-left p-4"></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={8} className="p-8 text-center text-muted-foreground">
                <RefreshCw className="inline w-4 h-4 mr-2 animate-spin" /> Loading…
              </td>
            </tr>
          ) : validRuns.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-8 text-center text-muted-foreground">
                No test runs yet.{' '}
                <Link to="/test-config" className="text-primary hover:underline">
                  Start a test
                </Link>
              </td>
            </tr>
          ) : (
            validRuns.map((run) => (
              <RunRow key={run.id} run={run} onDelete={(id) => deleteRun.mutate(id)} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Reports page ────────────────────────────────────────────────────────

export default function Reports() {
  const [tab, setTab] = useState<'swarm' | 'load'>('swarm');

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Reports</h1>
        <Link
          to="/agent-monitor"
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          New swarm run →
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab('swarm')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'swarm' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Swarm Bug Reports
        </button>
        <button
          onClick={() => setTab('load')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'load' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Load Test Runs
        </button>
      </div>

      {tab === 'swarm' ? <SwarmReportsTab /> : <LoadTestReportsTab />}
    </div>
  );
}
