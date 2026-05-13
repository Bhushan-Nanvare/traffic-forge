/**
 * Healer Agent — recovers a failed step by asking an LLM to inspect the
 * current page and find a replacement element/action.
 *
 * Provider-agnostic via the shared LLMClient (Anthropic, Groq, Cerebras,
 * Ollama, OpenRouter, DeepSeek, Gemini). Uses tool-use for structured
 * output — no JSON-parsing-of-text fragility.
 *
 * Called only when the Executor fails. Captures the page's interactive
 * elements (role + accessible name) and sends to the LLM with the failed
 * action. The LLM proposes a new StepAction; the Orchestrator retries with it.
 */

import type { Page } from 'playwright';
import type { AgentLLMConfig, StepAction, TestPlanStep, HealAttempt } from './types.js';
import {
  makeAdhocClient,
  getLLMClient,
  type LLMClient,
  type ToolSchema,
} from '../../../../shared/llm/index.js';
import { logger } from '../../../../shared/lib/logger.js';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Test Healer. A test step failed because a Playwright locator could not find an element. Inspect the page's interactive elements (role + accessible name pairs) and propose a replacement action that achieves the same intent.

Rules:
- Use roles + names from the elements list provided. Do not invent elements.
- If no plausible replacement exists, set action.type = "none" and explain why in diagnosis.
- Prefer the closest semantic match — same role, similar name. Examples: "Pay" → "Proceed to Payment"; "Sign in" → "Log in".
- Never propose CSS selectors or IDs. Roles + accessible names only.

Return your decision via the propose_replacement tool.`;

// ─── Tool schema (structured output) ─────────────────────────────────────────

const HEALER_TOOL: ToolSchema = {
  name: 'propose_replacement',
  description: 'Propose a replacement action or report that no replacement is possible',
  parameters: {
    type: 'object',
    properties: {
      diagnosis: {
        type: 'string',
        description: 'One sentence: what likely changed (renamed, moved, replaced)',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      action: {
        type: 'object',
        description: 'Replacement action — set type to "none" if no replacement is possible',
        properties: {
          type: {
            type: 'string',
            enum: [
              'navigate',
              'click',
              'fill',
              'expect_text',
              'expect_url',
              'wait_for',
              'wait_ms',
              'none',
            ],
          },
          url: { type: 'string' },
          role: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'string' },
          text: { type: 'string' },
          pattern: { type: 'string' },
          ms: { type: 'integer' },
        },
        required: ['type'],
      },
    },
    required: ['diagnosis', 'action'],
  },
};

interface HealerToolResult {
  diagnosis: string;
  confidence?: 'high' | 'medium' | 'low';
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
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface HealRequest {
  step: TestPlanStep;
  failedAction: StepAction;
  errorMessage: string;
  page: Page;
}

export async function healStep(req: HealRequest, config: AgentLLMConfig): Promise<HealAttempt> {
  const client = resolveClient(config);
  if (!client) {
    return {
      reason: req.errorMessage,
      diagnosis: 'No LLM provider available — healing skipped',
      proposedAction: req.failedAction,
      succeeded: false,
      ledToError: 'No healer LLM available',
    };
  }

  // Capture interactive elements — the data getByRole matches on
  const elements = await snapshotElements(req.page);
  const url = req.page.url();
  const userPrompt = buildUserPrompt(req, elements, url);

  let response: HealerToolResult;
  try {
    const result = await client.generateWithTool<HealerToolResult>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      tool: HEALER_TOOL,
      maxTokens: 512,
      cacheSystemPrompt: true,
    });
    response = result.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, stepIndex: req.step.index }, 'Healer LLM call failed');
    return {
      reason: req.errorMessage,
      diagnosis: 'Healer LLM call failed',
      proposedAction: req.failedAction,
      succeeded: false,
      ledToError: message,
    };
  }

  const action = buildAction(response.action);
  if (!action) {
    return {
      reason: req.errorMessage,
      diagnosis: response.diagnosis,
      proposedAction: req.failedAction,
      succeeded: false,
      ledToError: 'Healer returned no replacement action',
    };
  }

  logger.info(
    { stepIndex: req.step.index, diagnosis: response.diagnosis, action },
    'Healer proposed replacement',
  );

  return {
    reason: req.errorMessage,
    diagnosis: response.diagnosis,
    proposedAction: action,
    succeeded: false, // set true by orchestrator after retry passes
  };
}

// ─── Action builder ──────────────────────────────────────────────────────────

function buildAction(raw: HealerToolResult['action']): StepAction | null {
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
    case 'none':
    default:
      return null;
  }
}

// ─── Page introspection ──────────────────────────────────────────────────────

async function snapshotElements(page: Page): Promise<Array<{ role: string; name: string }>> {
  try {
    // @ts-ignore - body runs in browser context where DOM globals exist
    const items = await page.evaluate(() => {
      const ROLE_BY_TAG: Record<string, string> = {
        BUTTON: 'button',
        A: 'link',
        SELECT: 'combobox',
        TEXTAREA: 'textbox',
        IMG: 'img',
        H1: 'heading', H2: 'heading', H3: 'heading',
        H4: 'heading', H5: 'heading', H6: 'heading',
        UL: 'list', OL: 'list', LI: 'listitem',
        NAV: 'navigation', MAIN: 'main', FORM: 'form', DIALOG: 'dialog',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function getRole(el: any): string | null {
        const explicit = el.getAttribute('role');
        if (explicit) return explicit;
        if (el.tagName === 'INPUT') {
          const type = el.type || 'text';
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'submit' || type === 'button') return 'button';
          if (type === 'search') return 'searchbox';
          return 'textbox';
        }
        return ROLE_BY_TAG[el.tagName] ?? null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function getName(el: any): string {
        const aria = el.getAttribute('aria-label');
        if (aria) return String(aria).trim();
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          // eslint-disable-next-line no-undef
          const ref = (globalThis as any).document.getElementById(labelledBy);
          if (ref) return (ref.textContent ?? '').trim();
        }
        if (el.tagName === 'INPUT') {
          const id = el.getAttribute('id');
          if (id) {
            // eslint-disable-next-line no-undef
            const lbl = (globalThis as any).document.querySelector(
              'label[for="' + id.replace(/"/g, '\\"') + '"]',
            );
            if (lbl) return (lbl.textContent ?? '').trim();
          }
          if (el.placeholder) return String(el.placeholder).trim();
        }
        if (el.tagName === 'IMG') return String(el.alt ?? '').trim();
        return (el.textContent ?? '').trim();
      }
      const out: Array<{ role: string; name: string }> = [];
      // eslint-disable-next-line no-undef
      const all = (globalThis as any).document.querySelectorAll('*');
      for (const el of Array.from(all)) {
        const role = getRole(el);
        if (!role) continue;
        const name = getName(el).slice(0, 80);
        if (!name) continue;
        out.push({ role, name });
        if (out.length >= 200) break;
      }
      return out;
    });
    return items;
  } catch (err) {
    logger.warn({ err }, 'Element snapshot failed');
    return [];
  }
}

function buildUserPrompt(
  req: HealRequest,
  elements: Array<{ role: string; name: string }>,
  url: string,
): string {
  const elementList = elements
    .map((e) => `  ${e.role}: "${e.name}"`)
    .join('\n');
  return [
    `Current URL: ${url}`,
    `Failed step: ${req.step.description}`,
    `Original action: ${JSON.stringify(req.failedAction)}`,
    `Playwright error: ${req.errorMessage}`,
    ``,
    `Interactive elements available on the page:`,
    elementList || '  (no elements found)',
    ``,
    `Propose a replacement action via the propose_replacement tool.`,
  ].join('\n');
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
