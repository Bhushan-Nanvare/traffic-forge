/**
 * OpenAI-compatible provider adapter.
 *
 * Works with any service that implements the OpenAI Chat Completions API
 * with function/tool calling: Groq, Cerebras, OpenRouter, DeepSeek, and
 * actual OpenAI. The base URL and credentials are configured per provider.
 *
 * Pricing-per-million-tokens approximations are baked in for cost tracking.
 * Free tiers (Groq, Cerebras free) report estimatedUsd = 0.
 */
import OpenAI from 'openai';
import {
  type LLMClient,
  type LLMProvider,
  type GenerateOptions,
  type ToolCallResult,
  type TokenUsage,
  LLMProviderError,
} from './types.js';

interface ProviderProfile {
  baseURL: string;
  envVar: string;
  defaultModel: string;
  /** Per-million-token cost (input, output) — set both to 0 for free tiers. */
  pricing: { input: number; output: number };
}

const PROFILES: Record<
  Exclude<LLMProvider, 'anthropic' | 'ollama' | 'none'>,
  ProviderProfile
> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    pricing: { input: 0, output: 0 }, // free tier
  },
  cerebras: {
    baseURL: 'https://api.cerebras.ai/v1',
    envVar: 'CEREBRAS_API_KEY',
    defaultModel: 'llama-3.3-70b',
    pricing: { input: 0, output: 0 }, // free tier
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    pricing: { input: 0, output: 0 }, // free model variant
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    pricing: { input: 0.14, output: 0.28 },
  },
  gemini: {
    // Google's OpenAI-compatible endpoint — supports tool use as function calling
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    pricing: { input: 0, output: 0 }, // free tier exists with rate limits
  },
};

export class OpenAICompatibleLLMClient implements LLMClient {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly available: boolean;
  private readonly client?: OpenAI;
  private readonly pricing: { input: number; output: number };

  constructor(opts: { provider: keyof typeof PROFILES; apiKey?: string; model?: string }) {
    this.provider = opts.provider;
    const profile = PROFILES[opts.provider];
    if (!profile) {
      throw new Error(`Unknown OpenAI-compatible provider: ${opts.provider}`);
    }

    const apiKey = opts.apiKey ?? process.env[profile.envVar];
    this.model =
      opts.model ?? process.env[`${opts.provider.toUpperCase()}_MODEL`] ?? profile.defaultModel;
    this.pricing = profile.pricing;
    this.available = !!apiKey;

    if (apiKey) {
      this.client = new OpenAI({ apiKey, baseURL: profile.baseURL });
    }
  }

  async generateWithTool<T>(opts: GenerateOptions): Promise<ToolCallResult<T>> {
    if (!this.client) {
      throw new LLMProviderError(
        `${this.provider} API key not set`,
        'UNAVAILABLE',
        false,
        this.provider,
      );
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1_024,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: opts.tool.name,
              description: opts.tool.description,
              parameters: opts.tool.parameters,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: opts.tool.name } },
      });

      const choice = response.choices[0];
      const toolCall = choice?.message.tool_calls?.[0];

      if (!toolCall || toolCall.type !== 'function') {
        throw new LLMProviderError(
          `${this.provider} response did not include a tool call`,
          'NO_TOOL_CALL',
          false,
          this.provider,
        );
      }

      let parsed: T;
      try {
        parsed = JSON.parse(toolCall.function.arguments) as T;
      } catch {
        throw new LLMProviderError(
          `${this.provider} returned malformed JSON in tool arguments`,
          'INVALID_RESPONSE',
          false,
          this.provider,
        );
      }

      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedUsd:
          ((response.usage?.prompt_tokens ?? 0) * this.pricing.input +
            (response.usage?.completion_tokens ?? 0) * this.pricing.output) /
          1_000_000,
      };

      return { result: parsed, usage, provider: this.provider, model: this.model };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      throw this.classifyError(err);
    }
  }

  private classifyError(err: unknown): LLMProviderError {
    const message = err instanceof Error ? err.message : String(err);
    // OpenAI SDK errors carry status codes
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) {
      return new LLMProviderError(message, 'AUTH_FAILED', false, this.provider);
    }
    if (status === 429) {
      return new LLMProviderError(message, 'RATE_LIMITED', true, this.provider);
    }
    if (status === 400) {
      return new LLMProviderError(message, 'INVALID_RESPONSE', false, this.provider);
    }
    if (status && status >= 500) {
      return new LLMProviderError(message, 'NETWORK', true, this.provider);
    }
    return new LLMProviderError(message, 'UNKNOWN', true, this.provider);
  }
}
