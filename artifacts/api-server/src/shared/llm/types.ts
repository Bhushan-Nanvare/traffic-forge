/**
 * Common types for the LLM provider abstraction.
 *
 * Engines (planner, reporter, rcaEngine) call LLMClient.generateWithTool()
 * with a JSON Schema and get back the typed structured output. Each
 * provider (Anthropic, Groq, Cerebras, Ollama, etc.) implements the same
 * interface, so the engines never need to know which one is in use.
 */

export type LLMProvider =
  | 'anthropic'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'openrouter'
  | 'gemini'
  | 'deepseek'
  | 'none'; // forces heuristic fallback

/** JSON Schema for the tool's input parameters. Provider-agnostic shape. */
export interface ToolSchema {
  /** Name of the tool — providers use this to identify the tool in their API. */
  name: string;
  /** Human-readable description fed to the model. */
  description: string;
  /** JSON Schema for the tool's parameters. Providers translate as needed. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Token usage normalised across providers. Free providers report zeros. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedUsd: number;
}

export function zeroUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedUsd: 0,
  };
}

/** Input to a single tool-use call. */
export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  tool: ToolSchema;
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Cache the system prompt where supported (Anthropic). Defaults to true. */
  cacheSystemPrompt?: boolean;
}

/** Result of a successful tool call. */
export interface ToolCallResult<T = unknown> {
  /** Parsed tool input — typed by the caller via generic. */
  result: T;
  usage: TokenUsage;
  provider: LLMProvider;
  model: string;
}

/** Common error class with retry classification. */
export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AUTH_FAILED'
      | 'RATE_LIMITED'
      | 'INVALID_RESPONSE'
      | 'NO_TOOL_CALL'
      | 'NETWORK'
      | 'UNAVAILABLE'
      | 'UNKNOWN',
    public readonly retryable: boolean,
    public readonly provider: LLMProvider,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

/**
 * The interface every provider implements. A typical implementation:
 *  1. Translate ToolSchema to the provider's tool/function format
 *  2. Call the API with system + user prompt + tool schema
 *  3. Force the model to emit a tool call (provider's tool_choice / response_format)
 *  4. Parse the tool input, normalise usage, return typed result
 */
export interface LLMClient {
  readonly provider: LLMProvider;
  readonly model: string;
  /** True if the client has credentials/connectivity to actually call the API. */
  readonly available: boolean;

  /**
   * Run one tool-use call. The generic T is the type of the structured tool
   * input — caller is responsible for the type-cast assertion.
   */
  generateWithTool<T>(opts: GenerateOptions): Promise<ToolCallResult<T>>;
}
