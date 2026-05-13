/**
 * Anthropic provider adapter — wraps @anthropic-ai/sdk in the LLMClient
 * interface. Preserves the prompt-caching, tool-use, and cost-tracking
 * features that the original engines used.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  type LLMClient,
  type LLMProvider,
  type GenerateOptions,
  type ToolCallResult,
  type TokenUsage,
  LLMProviderError,
} from './types.js';

export class AnthropicLLMClient implements LLMClient {
  readonly provider: LLMProvider = 'anthropic';
  readonly model: string;
  readonly available: boolean;
  private readonly client?: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
    this.available = !!apiKey;
    if (apiKey) {
      this.client = new Anthropic({ apiKey, maxRetries: 0 });
    }
  }

  async generateWithTool<T>(opts: GenerateOptions): Promise<ToolCallResult<T>> {
    if (!this.client) {
      throw new LLMProviderError(
        'Anthropic API key not set',
        'UNAVAILABLE',
        false,
        this.provider,
      );
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1_024,
        system: [
          {
            type: 'text',
            text: opts.systemPrompt,
            ...(opts.cacheSystemPrompt !== false
              ? { cache_control: { type: 'ephemeral' as const } }
              : {}),
          },
        ],
        tools: [
          {
            name: opts.tool.name,
            description: opts.tool.description,
            input_schema: {
              type: 'object',
              properties: opts.tool.parameters.properties,
              required: opts.tool.parameters.required,
            },
          },
        ],
        tool_choice: { type: 'tool', name: opts.tool.name },
        messages: [{ role: 'user', content: opts.userPrompt }],
      });

      const toolUseBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (!toolUseBlock) {
        throw new LLMProviderError(
          'Anthropic response did not include a tool call',
          'NO_TOOL_CALL',
          false,
          this.provider,
        );
      }

      return {
        result: toolUseBlock.input as T,
        usage: this.computeUsage(response.usage),
        provider: this.provider,
        model: this.model,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      throw this.classifyError(err);
    }
  }

  private classifyError(err: unknown): LLMProviderError {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Anthropic.AuthenticationError) {
      return new LLMProviderError(message, 'AUTH_FAILED', false, this.provider);
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return new LLMProviderError(message, 'AUTH_FAILED', false, this.provider);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new LLMProviderError(message, 'RATE_LIMITED', true, this.provider);
    }
    if (err instanceof Anthropic.BadRequestError) {
      return new LLMProviderError(message, 'INVALID_RESPONSE', false, this.provider);
    }
    return new LLMProviderError(message, 'UNKNOWN', true, this.provider);
  }

  /** Haiku 4.5 pricing: $1/$5 per million tokens, with cache discounts. */
  private computeUsage(usage: Anthropic.Usage): TokenUsage {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const cacheReadTokens =
      (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    const cacheWriteTokens =
      (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

    const estimatedUsd =
      inputTokens * (1.0 / 1_000_000) +
      outputTokens * (5.0 / 1_000_000) +
      cacheWriteTokens * (1.25 / 1_000_000) +
      cacheReadTokens * (0.1 / 1_000_000);

    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, estimatedUsd };
  }
}
