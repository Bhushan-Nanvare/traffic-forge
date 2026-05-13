/**
 * LLM client factory — picks a provider based on environment, with a
 * fallback chain when the primary is unavailable.
 *
 * Configuration via environment variables:
 *   LLM_PROVIDER         — primary: anthropic | groq | cerebras | ollama |
 *                          openrouter | deepseek | none (default: ollama)
 *   LLM_FALLBACK         — comma-separated fallback list (default:
 *                          "groq,anthropic,ollama")
 *   ANTHROPIC_API_KEY    — Anthropic credentials
 *   GROQ_API_KEY         — Groq Cloud credentials (free tier)
 *   CEREBRAS_API_KEY     — Cerebras Cloud credentials (free tier)
 *   OPENROUTER_API_KEY   — OpenRouter credentials
 *   DEEPSEEK_API_KEY     — DeepSeek credentials (cheap)
 *   OLLAMA_HOST          — http://localhost:11434 by default
 *   OLLAMA_MODEL         — llama3.1:8b by default
 */
import { AnthropicLLMClient } from './anthropic.js';
import { OpenAICompatibleLLMClient } from './openai-compat.js';
import { OllamaLLMClient } from './ollama.js';
import {
  type LLMClient,
  type LLMProvider,
  type GenerateOptions,
  type ToolCallResult,
  LLMProviderError,
} from './types.js';
import { logger } from '../lib/logger.js';

function makeClient(provider: LLMProvider): LLMClient | null {
  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient();
    case 'groq':
    case 'cerebras':
    case 'openrouter':
    case 'deepseek':
    case 'gemini':
      return new OpenAICompatibleLLMClient({ provider });
    case 'ollama':
      return new OllamaLLMClient();
    case 'none':
      return null;
    default:
      return null;
  }
}

/**
 * Build a one-shot LLMClient using user-supplied credentials, bypassing
 * environment variables. Used by API endpoints that accept per-request
 * provider + apiKey from the UI (so users can paste their own key without
 * setting env vars).
 *
 * Returns null if the provider is invalid or required credentials missing.
 */
export interface AdhocClientOptions {
  /** Accepts every supported provider, plus 'claude' as a UI alias for 'anthropic'. */
  provider: LLMProvider | 'claude';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function makeAdhocClient(opts: AdhocClientOptions): LLMClient | null {
  // 'claude' is a UI-friendly alias for 'anthropic'
  const provider: LLMProvider =
    (opts.provider as string) === 'claude' ? 'anthropic' : (opts.provider as LLMProvider);
  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient({ apiKey: opts.apiKey, model: opts.model });
    case 'groq':
    case 'cerebras':
    case 'openrouter':
    case 'deepseek':
    case 'gemini':
      return new OpenAICompatibleLLMClient({
        provider,
        apiKey: opts.apiKey,
        model: opts.model,
      });
    case 'ollama':
      return new OllamaLLMClient({ host: opts.baseUrl, model: opts.model });
    case 'none':
    default:
      return null;
  }
}

function parseProviderList(value: string | undefined, fallback: LLMProvider[]): LLMProvider[] {
  if (!value) return fallback;
  const list = value
    .split(',')
    .map((s) => s.trim().toLowerCase() as LLMProvider)
    .filter((p) => p.length > 0);
  return list.length > 0 ? list : fallback;
}

/**
 * Resolve the list of providers to try, in order. The first entry is the
 * "primary" — if its API call succeeds we don't touch the fallbacks.
 */
function resolveProviderChain(): LLMProvider[] {
  const primary = (process.env.LLM_PROVIDER as LLMProvider | undefined) ?? 'ollama';
  const fallbacks = parseProviderList(process.env.LLM_FALLBACK, [
    'groq',
    'anthropic',
    'ollama',
  ]);
  // Dedupe while preserving order
  const seen = new Set<LLMProvider>();
  const chain: LLMProvider[] = [];
  for (const p of [primary, ...fallbacks]) {
    if (!seen.has(p)) {
      seen.add(p);
      chain.push(p);
    }
  }
  return chain;
}

/**
 * The exported client wraps the provider chain: tries the primary, then
 * falls back on UNAVAILABLE/AUTH_FAILED. Retryable errors stay on the
 * current provider with exponential back-off.
 */
export class FallbackLLMClient implements LLMClient {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly available: boolean;
  private readonly clients: LLMClient[];

  constructor() {
    const chain = resolveProviderChain();
    this.clients = chain
      .map((p) => makeClient(p))
      .filter((c): c is LLMClient => c !== null && c.available);

    if (this.clients.length === 0) {
      this.available = false;
      this.provider = 'none';
      this.model = 'none';
      logger.warn(
        { chain },
        'No LLM providers available — engines will use heuristic fallbacks',
      );
    } else {
      this.available = true;
      this.provider = this.clients[0].provider;
      this.model = this.clients[0].model;
      logger.info(
        {
          primary: this.clients[0].provider,
          model: this.clients[0].model,
          fallbacks: this.clients.slice(1).map((c) => c.provider),
        },
        'LLM client chain configured',
      );
    }
  }

  async generateWithTool<T>(opts: GenerateOptions): Promise<ToolCallResult<T>> {
    if (!this.available) {
      throw new LLMProviderError(
        'No LLM provider available',
        'UNAVAILABLE',
        false,
        'none',
      );
    }

    let lastError: LLMProviderError | undefined;
    for (const client of this.clients) {
      try {
        return await this.callWithRetry<T>(client, opts);
      } catch (err) {
        lastError = err instanceof LLMProviderError ? err : new LLMProviderError(
          String(err),
          'UNKNOWN',
          false,
          client.provider,
        );

        // Only fall through on UNAVAILABLE / AUTH_FAILED — these signal
        // the provider can't serve the request at all. Rate limits and
        // other retryable errors are already handled inside callWithRetry.
        if (lastError.code !== 'UNAVAILABLE' && lastError.code !== 'AUTH_FAILED') {
          throw lastError;
        }
        logger.warn(
          { provider: client.provider, code: lastError.code },
          'LLM provider unavailable — falling back',
        );
      }
    }

    throw lastError ?? new LLMProviderError('All providers exhausted', 'UNAVAILABLE', false, 'none');
  }

  /** 3 attempts with 1s/2s back-off on retryable errors. */
  private async callWithRetry<T>(
    client: LLMClient,
    opts: GenerateOptions,
  ): Promise<ToolCallResult<T>> {
    let lastError: LLMProviderError | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await client.generateWithTool<T>(opts);
      } catch (err) {
        const e =
          err instanceof LLMProviderError
            ? err
            : new LLMProviderError(String(err), 'UNKNOWN', true, client.provider);
        lastError = e;
        if (!e.retryable) throw e;
        if (attempt < 2) await sleep(1000 * Math.pow(2, attempt));
      }
    }
    throw lastError!;
  }
}

let cachedClient: FallbackLLMClient | undefined;

/** Returns a process-wide singleton. Construct once; reuse for every engine call. */
export function getLLMClient(): FallbackLLMClient {
  if (!cachedClient) {
    cachedClient = new FallbackLLMClient();
  }
  return cachedClient;
}

/** Reset the cached client — used by tests so env-var changes take effect. */
export function resetLLMClient(): void {
  cachedClient = undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
