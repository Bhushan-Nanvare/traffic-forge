/**
 * Shared types for the multi-agent scenario runner (Planner → Executor → Healer).
 *
 * Distinct from the swarm agent (random monkey clicker). The multi-agent system
 * takes a high-level GOAL like "verify premium login flow" and produces a
 * verified pass/fail with the exact step that broke (and an attempted recovery).
 */

// ─── Test Plan (output of Planner) ───────────────────────────────────────────

export type StepAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; role: string; name: string }      // semantic — getByRole
  | { type: 'fill'; role: string; name: string; value: string }
  | { type: 'expect_text'; text: string }              // assertion
  | { type: 'expect_url'; pattern: string }
  | { type: 'wait_for'; role: string; name: string }
  | { type: 'wait_ms'; ms: number };

export interface TestPlanStep {
  index: number;
  description: string;       // human-readable, e.g. "Click the Login button"
  action: StepAction;
  expected: string;          // what should happen after this step
}

export interface TestPlan {
  goal: string;
  rawMarkdown: string;       // original markdown returned by Planner (for audit)
  steps: TestPlanStep[];
  dataRequirements: string[];  // e.g. "premium account credentials"
  generatedBy: string;         // model used
}

// ─── Step Execution Result (output of Executor / Healer) ─────────────────────

export type StepStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'healed'      // initially failed, Healer recovered
  | 'skipped';

export interface StepResult {
  step: TestPlanStep;
  status: StepStatus;
  startedAt: number;
  finishedAt: number;
  error?: string;
  healAttempts?: HealAttempt[];   // populated only if Healer was invoked
  screenshot?: string | null;     // base64 PNG taken after step
  url?: string;                   // URL after step
}

export interface HealAttempt {
  reason: string;                 // what the Executor failed on
  diagnosis: string;              // what the Healer concluded from DOM
  proposedAction: StepAction;     // Healer's replacement action
  succeeded: boolean;
  ledToError?: string;
}

// ─── Scenario Run Summary (final output) ─────────────────────────────────────

export type ScenarioStatus = 'planning' | 'running' | 'passed' | 'failed' | 'aborted' | 'error';

export interface ScenarioFailureNarrative {
  cause: string;
  fix: string;
  model: string;
}

export interface ScenarioRunSummary {
  runId: string;
  goal: string;
  targetUrl: string;
  status: ScenarioStatus;
  plan: TestPlan | null;
  steps: StepResult[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  healedSteps: number;
  errorMessage?: string;
  /** LLM-generated app-fix suggestion. Set only when scenario.status === 'failed' and an LLM provider was configured. */
  failureNarrative?: ScenarioFailureNarrative;
}

// ─── Agent Config ────────────────────────────────────────────────────────────

// Mirrors the shared LLM provider list. 'claude' is an alias kept for the UI;
// internally maps to 'anthropic'. We accept both for backwards-compat with
// requests that already used 'claude'.
export type AgentLLMProvider =
  | 'anthropic'
  | 'claude'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'openrouter'
  | 'deepseek'
  | 'gemini'
  | 'none';

export interface AgentLLMConfig {
  provider: AgentLLMProvider;
  apiKey?: string;
  model?: string;       // override default per provider
  baseUrl?: string;     // for ollama
}

export interface ScenarioConfig {
  goal: string;
  targetUrl: string;
  maxSteps?: number;        // safety cap (default 30)
  stepTimeoutMs?: number;   // (default 8000)
  allowHealing?: boolean;   // default true
  headless?: boolean;       // default true; set false to watch the browser
  /** Path to a Playwright storageState.json (from a seedAuth run) for pre-authenticated tests. */
  storageStatePath?: string;
  llm: AgentLLMConfig;
}

// ─── Live event stream (broadcast over WebSocket) ────────────────────────────

export type ScenarioEvent =
  | { type: 'planning' }
  | { type: 'plan_ready'; plan: TestPlan }
  | { type: 'step_start'; step: TestPlanStep }
  | { type: 'step_end'; result: StepResult }
  | { type: 'healing'; stepIndex: number; reason: string }
  | { type: 'done'; summary: ScenarioRunSummary }
  | { type: 'error'; message: string };
