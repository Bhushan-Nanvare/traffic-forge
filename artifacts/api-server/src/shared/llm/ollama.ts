/**
 * Ollama provider adapter — calls a locally-running Ollama server.
 *
 * Ollama runs on http://localhost:11434 by default. Llama 3.1+ models
 * support tool use natively, but smaller models (8B) sometimes return
 * malformed JSON. We treat those as INVALID_RESPONSE and let the engine's
 * heuristic fallback kick in.
 *
 * Cost is always zero — Ollama is local and free.
 */
import { Ollama, type ToolCall } from 'ollama';
import {
  type LLMClient,
  type LLMProvider,
  type GenerateOptions,
  type ToolCallResult,
  zeroUsage,
  LLMProviderError,
} from './types.js';

export class OllamaLLMClient implements LLMClient {
  readonly provider: LLMProvider = 'ollama';
  readonly model: string;
  readonly available = true; // Ollama doesn't require credentials; reachability checked at call time
  private readonly client: Ollama;

  constructor(opts: { host?: string; model?: string } = {}) {
    const host = opts.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';
    this.model = opts.model ?? process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
    this.client = new Ollama({ host });
  }

  async generateWithTool<T>(opts: GenerateOptions): Promise<ToolCallResult<T>> {
    try {
      const response = await this.client.chat({
        model: this.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        // Ollama's TS types are too narrow for generic Record-based JSON schemas;
        // cast through unknown — the runtime contract still matches.
        tools: [
          {
            type: 'function',
            function: {
              name: opts.tool.name,
              description: opts.tool.description,
              parameters: opts.tool.parameters as unknown as never,
            },
          },
        ],
        // Ollama doesn't have a strict tool_choice — the system prompt
        // already instructs the model to call the tool. We post-validate.
        options: {
          temperature: 0.2, // lower temp = more reliable structured output
          num_predict: opts.maxTokens ?? 1_024,
        },
      });

      const toolCall: ToolCall | undefined = response.message.tool_calls?.[0];

      if (!toolCall) {
        throw new LLMProviderError(
          'Ollama response did not include a tool call (model may not support tool use, or output was malformed)',
          'NO_TOOL_CALL',
          false,
          this.provider,
        );
      }

      // Ollama returns tool args already parsed as an object
      const args = toolCall.function.arguments;
      const result = (typeof args === 'string' ? safeParse<T>(args) : (args as T)) as T;

      return {
        result,
        usage: zeroUsage(),
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
    if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
      return new LLMProviderError(
        `Ollama server not reachable: ${message}. Run \`ollama serve\` to start it.`,
        'UNAVAILABLE',
        false,
        this.provider,
      );
    }
    if (/model.*not found|pull the model/i.test(message)) {
      return new LLMProviderError(
        `Ollama model not installed: ${message}. Run \`ollama pull ${this.model}\` first.`,
        'UNAVAILABLE',
        false,
        this.provider,
      );
    }
    return new LLMProviderError(message, 'UNKNOWN', true, this.provider);
  }
}

function safeParse<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new LLMProviderError(
      `Ollama returned non-JSON tool arguments: ${s.slice(0, 200)}`,
      'INVALID_RESPONSE',
      false,
      'ollama',
    );
  }
}
