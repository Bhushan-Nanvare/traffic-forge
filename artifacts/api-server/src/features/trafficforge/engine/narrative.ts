/**
 * LLM Fix Narrative — generates a plain-English cause + fix suggestion
 * for each unique bug detected by the swarm agent, plus an app-fix
 * narrative when a Scenario step fails after Healer exhausts retries.
 *
 * Provider-agnostic via the shared LLMClient abstraction (Anthropic, Groq,
 * Cerebras, Ollama, OpenRouter, DeepSeek, Gemini). Uses tool-use for
 * structured output — no JSON parsing of free-form text.
 *
 * One call per UNIQUE bug (deduplicated by fingerprint), fired AFTER the
 * test run — never during the test, so it cannot slow down agent traversal.
 */

import type { DetectedFailure, LLMNarrative } from './evidenceCapture.js';
import type { StepResult, HealAttempt, AgentLLMProvider } from './multiAgent/types.js';
import {
  makeAdhocClient,
  getLLMClient,
  type LLMClient,
  type ToolSchema,
  LLMProviderError,
} from '../../../shared/llm/index.js';
import { logger } from '../../../shared/lib/logger.js';

// ─── Provider config ─────────────────────────────────────────────────────────

export type NarrativeProvider = AgentLLMProvider;

export interface NarrativeConfig {
  provider: NarrativeProvider;
  apiKey?: string;
  /** Override default model. Optional. */
  model?: string;
  /** Custom base URL (Ollama only). Optional. */
  baseUrl?: string;
}

// ─── System prompts (cached on Anthropic) ────────────────────────────────────

const BUG_FIX_SYSTEM_PROMPT = `You are a frontend bug analyst. You receive evidence about a specific bug found by an automated swarm agent that randomly clicks elements on a web page and records what breaks.

Your job: explain the bug in plain English (one sentence) and suggest a concrete fix (one sentence).

Rules:
- "cause": one sentence explaining the most likely root cause based on evidence
- "fix": one sentence describing the most likely fix (file/function/concept, not a full diff)
- Keep both sentences under 30 words each
- Be specific to the evidence — never give generic advice like "check your code"
- If the evidence is insufficient, say so honestly in the cause field

Bug type meanings:
- crash: A JavaScript error was thrown on the page (uncaught exception)
- http_error: A network request returned 4xx/5xx
- network: A request failed at the network layer (DNS, CORS, timeout, ECONNREFUSED)
- console_error: console.error() was called by the page
- navigation_failure: Click triggered no DOM change, no URL change, and no network — the handler is broken or missing`;

const SCENARIO_FAILURE_SYSTEM_PROMPT = `You are an application bug analyst. A goal-directed test scenario failed at a specific step. The Healer agent already tried to recover (retry with different locators) and could not — meaning this is likely a real application bug, not a flaky test.

You receive:
- The high-level goal of the scenario
- The step that failed and what it was trying to do
- The Playwright error message
- Heal attempts the Healer made and why they didn't work
- The URL when the failure happened

Rules:
- Focus on what's broken in the application, NOT what's wrong with the test selector.
- Be specific: name a likely component/file/function/state when you can infer it.
- Keep both fields under 30 words each.
- If evidence is insufficient, say so honestly in the cause field.`;

// ─── Tool schemas (structured output) ────────────────────────────────────────

const NARRATIVE_TOOL: ToolSchema = {
  name: 'report_narrative',
  description: 'Report the cause of a bug and a suggested fix',
  parameters: {
    type: 'object',
    properties: {
      cause: { type: 'string', description: 'One sentence: most likely root cause' },
      fix: { type: 'string', description: 'One sentence: concrete fix suggestion' },
    },
    required: ['cause', 'fix'],
  },
};

interface NarrativeToolResult {
  cause: string;
  fix: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate fix narratives for every unique failure in the map.
 * Mutates each failure in-place by setting `llmNarrative`.
 *
 * Failures that error out are silently skipped (logged at warn level).
 * The function never throws — a missing narrative is not fatal.
 */
export async function enrichFailuresWithNarratives(
  failures: Map<string, DetectedFailure>,
  config: NarrativeConfig,
): Promise<void> {
  const client = resolveClient(config);
  if (!client) {
    logger.debug('Narrative generation skipped — no provider available');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const [fingerprint, failure] of failures) {
    try {
      const narrative = await generateBugNarrative(failure, client);
      failure.llmNarrative = narrative;
      success++;
    } catch (err) {
      failed++;
      logger.warn({ err, fingerprint }, 'Narrative generation failed for bug');
    }
  }

  logger.info({ success, failed, total: failures.size }, 'Narratives generated');
}

// ─── Bug narrative (Swarm) ───────────────────────────────────────────────────

async function generateBugNarrative(
  failure: DetectedFailure,
  client: LLMClient,
): Promise<LLMNarrative> {
  const userPrompt = buildBugUserPrompt(failure);
  const result = await client.generateWithTool<NarrativeToolResult>({
    systemPrompt: BUG_FIX_SYSTEM_PROMPT,
    userPrompt,
    tool: NARRATIVE_TOOL,
    maxTokens: 256,
    cacheSystemPrompt: true,
  });
  return {
    cause: result.result.cause,
    fix: result.result.fix,
    model: result.model,
  };
}

function buildBugUserPrompt(failure: DetectedFailure): string {
  const consoleErrors = failure.evidence.consoleLogs
    .filter((l) => l.level === 'error')
    .slice(0, 5)
    .map((l) => `  ${l.text.slice(0, 200)}`)
    .join('\n');

  const networkErrors = failure.evidence.networkRequests
    .filter((r) => r.failed || (r.status != null && r.status >= 400))
    .slice(0, 5)
    .map((r) => `  ${r.method} ${r.url} → ${r.status ?? 'FAILED'}${r.failureReason ? ` (${r.failureReason})` : ''}`)
    .join('\n');

  const lines: string[] = [
    `Bug type: ${failure.type}`,
    `Error message: ${failure.message}`,
  ];
  if (failure.stack) {
    lines.push(`Stack:\n${failure.stack.slice(0, 600)}`);
  }
  lines.push(`Element clicked: "${failure.elementText}" (selector: ${failure.elementSelector})`);
  lines.push(`URL when click happened: ${failure.evidence.urlBefore}`);
  if (failure.evidence.urlAfter !== failure.evidence.urlBefore) {
    lines.push(`URL after click: ${failure.evidence.urlAfter}`);
  }
  if (consoleErrors) lines.push(`Console errors:\n${consoleErrors}`);
  if (networkErrors) lines.push(`Network errors:\n${networkErrors}`);
  lines.push(`DOM mutated: ${failure.evidence.domMutated ? 'yes' : 'no'}`);
  lines.push(`Network fired: ${failure.evidence.networkFired ? 'yes' : 'no'}`);
  return lines.join('\n');
}

// ─── Scenario Failure Narrative ──────────────────────────────────────────────

export interface ScenarioFailureContext {
  goal: string;
  failedStep: StepResult;
  healAttempts: HealAttempt[];
}

/**
 * App-fix suggestion when a Scenario step fails after Healer exhausts retries.
 * Returns null if no provider is available — best-effort, never throws.
 */
export async function generateScenarioFailureNarrative(
  ctx: ScenarioFailureContext,
  config: NarrativeConfig,
): Promise<LLMNarrative | null> {
  const client = resolveClient(config);
  if (!client) return null;

  try {
    const result = await client.generateWithTool<NarrativeToolResult>({
      systemPrompt: SCENARIO_FAILURE_SYSTEM_PROMPT,
      userPrompt: buildScenarioFailurePrompt(ctx),
      tool: NARRATIVE_TOOL,
      maxTokens: 256,
      cacheSystemPrompt: true,
    });
    return { cause: result.result.cause, fix: result.result.fix, model: result.model };
  } catch (err) {
    if (err instanceof LLMProviderError) {
      logger.warn({ code: err.code, provider: err.provider }, 'Scenario failure narrative skipped');
    } else {
      logger.warn({ err }, 'Scenario failure narrative threw');
    }
    return null;
  }
}

function buildScenarioFailurePrompt(ctx: ScenarioFailureContext): string {
  const lines: string[] = [
    `Scenario goal: ${ctx.goal}`,
    `Failed step #${ctx.failedStep.step.index + 1}: ${ctx.failedStep.step.description}`,
    `Step action: ${JSON.stringify(ctx.failedStep.step.action)}`,
    `Expected: ${ctx.failedStep.step.expected}`,
    `Playwright error: ${ctx.failedStep.error ?? 'unknown'}`,
    `URL when failed: ${ctx.failedStep.url ?? '(unknown)'}`,
  ];
  if (ctx.healAttempts.length > 0) {
    lines.push('Heal attempts made by the Healer:');
    for (const h of ctx.healAttempts) {
      lines.push(
        `  - ${h.diagnosis}; tried ${JSON.stringify(h.proposedAction)}; ${h.succeeded ? 'succeeded' : (h.ledToError ?? 'still failed')}`,
      );
    }
  }
  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the LLMClient to use for a given config. Strategy:
 *  - If provider === 'none' -> null (skip)
 *  - If user supplied an apiKey (or provider is ollama) -> ad-hoc client
 *  - Otherwise -> shared singleton (env-driven, with provider chain fallback)
 *
 * Returning null means "no narrative for this run" — callers must handle it.
 */
function resolveClient(config: NarrativeConfig): LLMClient | null {
  if (config.provider === 'none') return null;

  // User-provided creds get priority
  if (config.apiKey || config.provider === 'ollama') {
    const adhoc = makeAdhocClient({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });
    if (adhoc?.available) return adhoc;
  }

  // Fall back to env-configured singleton
  const shared = getLLMClient();
  return shared.available ? shared : null;
}
