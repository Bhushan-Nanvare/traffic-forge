/**
 * Planner Agent — turns a high-level test goal into a structured TestPlan.
 *
 * Provider-agnostic via the shared LLMClient (Anthropic, Groq, Cerebras,
 * Ollama, OpenRouter, DeepSeek, Gemini). Uses tool-use for structured
 * output — steps come back already typed, no markdown-parsing fragility.
 *
 * One LLM call per scenario. Errors throw — the orchestrator handles retries.
 */

import type { AgentLLMConfig, TestPlan, TestPlanStep, StepAction } from './types.js';
import {
  makeAdhocClient,
  getLLMClient,
  type LLMClient,
  type ToolSchema,
} from '../../../../shared/llm/index.js';
import { logger } from '../../../../shared/lib/logger.js';

// ─── System prompt (cached on Anthropic) ─────────────────────────────────────

const SYSTEM_PROMPT = `You are a Test Planner. Given a high-level testing goal and a target URL, produce a step-by-step test plan.

Rules:
- Always start with a "navigate" step to the target URL.
- Use semantic locators (role + accessible name) — never CSS selectors or IDs.
- Each step must have exactly one action.
- Include at least one expect_* step at the end to verify the goal.
- Be conservative: 5-15 steps. Prefer fewer steps over more.
- Use plain English in "name" — what a user reads, not internal IDs.

If the goal cannot be tested without missing data (e.g. login but no credentials), still produce the plan and list what's missing under dataRequirements.

Return your plan via the generate_test_plan tool.`;

// ─── Tool schema (structured output) ─────────────────────────────────────────

const PLANNER_TOOL: ToolSchema = {
  name: 'generate_test_plan',
  description: 'Produce a structured test plan with typed steps',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Restate the goal in one sentence' },
      dataRequirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pieces of test data needed (e.g. "premium account credentials")',
      },
      steps: {
        type: 'array',
        description: '5-15 ordered steps that verify the goal',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Short human-readable description' },
            expected: { type: 'string', description: 'What should happen after this step' },
            action: {
              type: 'object',
              description: 'Exactly one action to perform',
              properties: {
                type: {
                  type: 'string',
                  enum: ['navigate', 'click', 'fill', 'expect_text', 'expect_url', 'wait_for', 'wait_ms'],
                },
                url: { type: 'string', description: 'For navigate' },
                role: {
                  type: 'string',
                  description: 'ARIA role for click/fill/wait_for (button, link, textbox, etc.)',
                },
                name: { type: 'string', description: 'Accessible name for click/fill/wait_for' },
                value: { type: 'string', description: 'Text to type for fill' },
                text: { type: 'string', description: 'Substring to match for expect_text' },
                pattern: { type: 'string', description: 'URL pattern for expect_url' },
                ms: { type: 'integer', description: 'Milliseconds for wait_ms' },
              },
              required: ['type'],
            },
          },
          required: ['description', 'action', 'expected'],
        },
      },
    },
    required: ['goal', 'steps', 'dataRequirements'],
  },
};

interface PlannerToolResult {
  goal: string;
  dataRequirements: string[];
  steps: Array<{
    description: string;
    expected: string;
    action: {
      type: string;
      url?: string;
      role?: string;
      name?: string;
      value?: string;
      text?: string;
      pattern?: string;
      ms?: number;
    };
  }>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateTestPlan(
  goal: string,
  targetUrl: string,
  config: AgentLLMConfig,
): Promise<TestPlan> {
  const client = resolveClient(config);
  if (!client) {
    throw new Error('Planner requires an available LLM provider');
  }

  const userPrompt = `Goal: ${goal}\nTarget URL: ${targetUrl}\n\nProduce the test plan now.`;

  const response = await client.generateWithTool<PlannerToolResult>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tool: PLANNER_TOOL,
    maxTokens: 2_048,
    cacheSystemPrompt: true,
  });

  const steps = response.result.steps
    .map((s, idx) => {
      const action = buildAction(s.action);
      if (!action) return null;
      return {
        index: idx,
        description: s.description,
        action,
        expected: s.expected,
      } satisfies TestPlanStep;
    })
    .filter((s): s is TestPlanStep => s !== null);

  // Build a markdown audit trail from the structured output (for the UI plan view)
  const rawMarkdown = renderPlanMarkdown(response.result, steps);

  logger.info(
    { goal, steps: steps.length, model: response.model, provider: response.provider },
    'Test plan generated',
  );

  return {
    goal,
    rawMarkdown,
    steps,
    dataRequirements: response.result.dataRequirements ?? [],
    generatedBy: response.model,
  };
}

// ─── Action builder ──────────────────────────────────────────────────────────

function buildAction(raw: PlannerToolResult['steps'][number]['action']): StepAction | null {
  switch (raw.type) {
    case 'navigate':
      return raw.url ? { type: 'navigate', url: raw.url } : null;
    case 'click':
      return raw.role && raw.name ? { type: 'click', role: raw.role, name: raw.name } : null;
    case 'fill':
      return raw.role && raw.name && raw.value !== undefined
        ? { type: 'fill', role: raw.role, name: raw.name, value: raw.value }
        : null;
    case 'expect_text':
      return raw.text ? { type: 'expect_text', text: raw.text } : null;
    case 'expect_url':
      return raw.pattern ? { type: 'expect_url', pattern: raw.pattern } : null;
    case 'wait_for':
      return raw.role && raw.name ? { type: 'wait_for', role: raw.role, name: raw.name } : null;
    case 'wait_ms':
      return Number.isFinite(raw.ms) && raw.ms !== undefined ? { type: 'wait_ms', ms: raw.ms } : null;
    default:
      return null;
  }
}

// ─── Markdown audit trail ────────────────────────────────────────────────────

function renderPlanMarkdown(raw: PlannerToolResult, steps: TestPlanStep[]): string {
  const lines: string[] = [`## Goal`, raw.goal, ''];
  if (raw.dataRequirements.length > 0) {
    lines.push('## Data Requirements');
    for (const d of raw.dataRequirements) lines.push(`- ${d}`);
    lines.push('');
  }
  lines.push('## Steps');
  for (const s of steps) {
    const args = describeAction(s.action);
    lines.push(`${s.index + 1}. **${s.description}** — \`action: ${s.action.type}\` ${args}`);
    if (s.expected) lines.push(`   Expected: ${s.expected}`);
  }
  return lines.join('\n');
}

function describeAction(action: StepAction): string {
  switch (action.type) {
    case 'navigate':
      return `\`url: ${action.url}\``;
    case 'click':
    case 'wait_for':
      return `\`role: ${action.role}\` \`name: ${action.name}\``;
    case 'fill':
      return `\`role: ${action.role}\` \`name: ${action.name}\` \`value: ${action.value}\``;
    case 'expect_text':
      return `\`text: ${action.text}\``;
    case 'expect_url':
      return `\`pattern: ${action.pattern}\``;
    case 'wait_ms':
      return `\`ms: ${action.ms}\``;
  }
}

// ─── Markdown parser (preserved for backwards-compat tests) ──────────────────

/**
 * Tolerant markdown parser kept for the existing test suite. The new
 * structured output via tool-use bypasses this entirely, but the parser
 * still has value if anyone ever needs to import an external markdown plan.
 */
export function parsePlanMarkdown(md: string): TestPlanStep[] {
  const steps: TestPlanStep[] = [];

  const headerMatch = md.match(/^## Steps\s*$/m);
  if (!headerMatch || headerMatch.index === undefined) return steps;
  const after = md.slice(headerMatch.index + headerMatch[0].length);
  const nextHeader = after.search(/^##\s/m);
  const stepsBlock = nextHeader === -1 ? after : after.slice(0, nextHeader);

  const chunks: Array<{ index: number; body: string }> = [];
  const markerRegex = /^\s*(\d+)\.\s/gm;
  let lastIndex = -1;
  let lastNum = -1;
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(stepsBlock)) !== null) {
    if (lastIndex >= 0) {
      chunks.push({ index: lastNum, body: stepsBlock.slice(lastIndex, m.index) });
    }
    lastNum = parseInt(m[1], 10) - 1;
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex >= 0) {
    chunks.push({ index: lastNum, body: stepsBlock.slice(lastIndex) });
  }

  for (const { index, body } of chunks) {
    const description = (body.match(/\*\*(.+?)\*\*/)?.[1] ?? body.split('\n')[0] ?? '').trim();
    const expected = (body.match(/^[ \t]*Expected:\s*(.+)$/im)?.[1] ?? '').trim();

    const pairs = new Map<string, string>();
    for (const span of body.matchAll(/`([^`]+)`/g)) {
      const inner = span[1];
      const colonIdx = inner.indexOf(':');
      if (colonIdx === -1) continue;
      const key = inner.slice(0, colonIdx).trim().toLowerCase();
      const value = inner.slice(colonIdx + 1).trim();
      if (key && value) pairs.set(key, value);
    }

    const actionType = pairs.get('action');
    if (!actionType) continue;

    const action = buildActionFromPairs(actionType, pairs);
    if (!action) continue;

    steps.push({ index, description, action, expected });
  }

  return steps;
}

function buildActionFromPairs(type: string, pairs: Map<string, string>): StepAction | null {
  switch (type) {
    case 'navigate':
      return pairs.get('url') ? { type: 'navigate', url: pairs.get('url')! } : null;
    case 'click':
      return pairs.get('role') && pairs.get('name')
        ? { type: 'click', role: pairs.get('role')!, name: pairs.get('name')! }
        : null;
    case 'fill':
      return pairs.get('role') && pairs.get('name') && pairs.get('value') !== undefined
        ? { type: 'fill', role: pairs.get('role')!, name: pairs.get('name')!, value: pairs.get('value')! }
        : null;
    case 'expect_text':
      return pairs.get('text') ? { type: 'expect_text', text: pairs.get('text')! } : null;
    case 'expect_url':
      return pairs.get('pattern') ? { type: 'expect_url', pattern: pairs.get('pattern')! } : null;
    case 'wait_for':
      return pairs.get('role') && pairs.get('name')
        ? { type: 'wait_for', role: pairs.get('role')!, name: pairs.get('name')! }
        : null;
    case 'wait_ms': {
      const ms = parseInt(pairs.get('ms') ?? '', 10);
      return Number.isFinite(ms) ? { type: 'wait_ms', ms } : null;
    }
    default:
      return null;
  }
}

// ─── Client resolver ─────────────────────────────────────────────────────────

function resolveClient(config: AgentLLMConfig): LLMClient | null {
  if (config.provider === 'none') return null;
  if (config.apiKey || config.provider === 'ollama') {
    const adhoc = makeAdhocClient({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });
    if (adhoc?.available) return adhoc;
  }
  const shared = getLLMClient();
  return shared.available ? shared : null;
}
