/**
 * Root Cause Analysis Engine — correlates bugs, events, and metrics using
 * any supported LLM provider.
 *
 * Provider-agnostic via the LLMClient abstraction (default: Ollama, free
 * fallbacks: Groq, Anthropic). Configure via LLM_PROVIDER env var.
 */
import type {
  RCAReport,
  RCAContext,
  CausalLink,
  RCAEvidence,
  RCARecommendation,
  AlternativeHypothesis,
} from '../types/rca.js';
import type { BugType } from '../types/bug.js';
import {
  getLLMClient,
  type LLMClient,
  type ToolSchema,
  zeroUsage,
  LLMProviderError,
  type TokenUsage,
} from '../../../shared/llm/index.js';

// ─── Cost Tracking (re-exported for backwards compatibility) ─────────────────

export interface RCACost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedUsd: number;
}

// ─── Static System Prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert distributed systems debugger specializing in root cause analysis.
You receive evidence from concurrent load tests and produce precise causal hypotheses.

Your analysis must:
1. Identify the PRIMARY hypothesis — the most likely root cause given the evidence
2. Identify 1-2 ALTERNATIVE hypotheses — plausible competing explanations with
   their own confidence scores. These help engineers when the primary is wrong.
3. Build a causal chain — a sequence of cause-effect steps from trigger to observable symptom
4. Rate confidence 0–1 for each hypothesis based on evidence quality and completeness
5. Provide 2-3 targeted recommendations with measurable impact

Multi-hypothesis approach: distributed-system bugs often have multiple plausible
causes. A senior engineer will list the leading suspect AND the runners-up so
the team can investigate in parallel and avoid tunnel vision on the wrong cause.

Bug type semantics:
- race_condition: shared mutable state accessed without synchronization
- persistence_failure: writes not committed before reads see stale state
- realtime_sync_failure: pub/sub or WebSocket events dropped or delayed
- data_inconsistency: divergent state across replicas, caches, or views
- order_violation: events ordered by client clock instead of server clock
- visibility_failure: writes not broadcast to all relevant subscribers
- unknown: insufficient evidence; recommend adding instrumentation

Be specific: name the locking mechanism, the SQL clause, the WebSocket event type.`;

// ─── Tool Schema ──────────────────────────────────────────────────────────────

const HYPOTHESIS_TOOL: ToolSchema = {
  name: 'generate_hypothesis',
  description:
    'Generate the primary + 1-2 alternative root cause hypotheses for a bug detected during load testing',
  parameters: {
    type: 'object',
    properties: {
      rootCause: {
        type: 'string',
        description:
          'Precise one-sentence PRIMARY root cause (specific system component + failure mode)',
      },
      description: {
        type: 'string',
        description: '2-3 sentences explaining how the primary root cause leads to the observed bug',
      },
      causalChain: {
        type: 'array',
        description: 'Ordered list of cause-effect steps for the primary hypothesis',
        items: {
          type: 'object',
          properties: {
            step: { type: 'integer' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['observation', 'inference', 'conclusion'] },
          },
          required: ['step', 'description', 'type'],
        },
      },
      confidence: {
        type: 'number',
        description: 'Primary confidence score 0.0–1.0 based on evidence quality',
      },
      alternatives: {
        type: 'array',
        description:
          '1-2 ranked ALTERNATIVE hypotheses worth investigating if the primary is wrong',
        items: {
          type: 'object',
          properties: {
            rootCause: { type: 'string', description: 'Alternative root cause (one sentence)' },
            description: { type: 'string', description: 'Why this alternative explains the bug' },
            confidence: { type: 'number', description: 'Confidence 0.0-1.0 (lower than primary)' },
            rationale: {
              type: 'string',
              description:
                'Why this alternative is worth considering despite being less likely than the primary',
            },
          },
          required: ['rootCause', 'description', 'confidence', 'rationale'],
        },
      },
    },
    required: ['rootCause', 'description', 'causalChain', 'confidence'],
  },
};

// ─── RCA Engine ───────────────────────────────────────────────────────────────

export class RCAEngine {
  private readonly llm: LLMClient;

  constructor(opts: { llm?: LLMClient } = {}) {
    this.llm = opts.llm ?? getLLMClient();
  }

  async analyze(ctx: RCAContext): Promise<RCAReport & { cost: RCACost }> {
    const evidence = this.collectEvidence(ctx);
    const recommendations = this.buildRecommendations(ctx);

    const { hypothesis, causalChain, confidence, alternatives, cost } =
      await this.generateHypothesis(ctx, evidence);

    return {
      id: `rca-${ctx.bug.id}`,
      bugId: ctx.bug.id,
      rootCause: hypothesis.rootCause,
      causalChain,
      evidence,
      hypothesis: hypothesis.description,
      confidence,
      recommendations,
      alternatives,
      generatedAt: Date.now(),
      cost,
    };
  }

  // ─── Evidence Collection ──────────────────────────────────────────────────

  private collectEvidence(ctx: RCAContext): RCAEvidence[] {
    const evidence: RCAEvidence[] = [];

    for (const e of ctx.bug.evidence) {
      evidence.push({
        source: 'event',
        description: e.description,
        weight: 0.7,
      });
    }

    if (ctx.metrics) {
      for (const [key, value] of Object.entries(ctx.metrics)) {
        if (this.isAnomalous(key, value)) {
          evidence.push({
            source: 'metric',
            description: `${key} = ${value}`,
            weight: 0.6,
          });
        }
      }
    }

    return evidence;
  }

  private isAnomalous(key: string, value: number): boolean {
    if (key.includes('error')) return value > 0.05;
    if (key.includes('duration') || key.includes('latency')) return value > 1000;
    if (key.includes('cpu')) return value > 80;
    return false;
  }

  // ─── Hypothesis Generation ────────────────────────────────────────────────

  private async generateHypothesis(
    ctx: RCAContext,
    evidence: RCAEvidence[],
  ): Promise<{
    hypothesis: { rootCause: string; description: string };
    causalChain: CausalLink[];
    confidence: number;
    alternatives: AlternativeHypothesis[];
    cost: TokenUsage;
  }> {
    if (!this.llm.available) {
      return {
        hypothesis: this.buildHeuristicHypothesis(ctx),
        causalChain: this.buildHeuristicCausalChain(ctx, evidence),
        confidence: this.scoreConfidence(evidence),
        alternatives: this.buildHeuristicAlternatives(ctx),
        cost: zeroUsage(),
      };
    }

    try {
      const evidenceSummary = evidence
        .slice(0, 5)
        .map((e) => `[${e.source}, weight=${e.weight.toFixed(1)}] ${e.description}`)
        .join('\n');

      const userPrompt = `Perform root cause analysis on this bug:

Bug: ${ctx.bug.title}
Type: ${ctx.bug.type}
Severity: ${ctx.bug.severity}
App Type: ${ctx.appType}
Confidence from detector: ${Math.round(ctx.bug.confidence * 100)}%

Evidence (${evidence.length} pieces):
${evidenceSummary || 'No evidence available'}

Anomalous metrics: ${
        ctx.metrics
          ? Object.entries(ctx.metrics)
              .filter(([k, v]) => this.isAnomalous(k, v))
              .map(([k, v]) => `${k}=${v}`)
              .join(', ') || 'none'
          : 'none'
      }`;

      const { result, usage } = await this.llm.generateWithTool<{
        rootCause: string;
        description: string;
        causalChain: CausalLink[];
        confidence: number;
        alternatives?: Array<{
          rootCause: string;
          description: string;
          confidence: number;
          rationale: string;
        }>;
      }>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        tool: HYPOTHESIS_TOOL,
        maxTokens: 2_048,
      });

      const alternatives: AlternativeHypothesis[] = (result.alternatives ?? []).map((alt, i) => ({
        rank: i + 2, // primary is rank 1
        rootCause: alt.rootCause,
        description: alt.description,
        confidence: Math.min(1, Math.max(0, alt.confidence)),
        rationale: alt.rationale,
      }));

      return {
        hypothesis: { rootCause: result.rootCause, description: result.description },
        causalChain: result.causalChain,
        confidence: Math.min(1, Math.max(0, result.confidence)),
        alternatives,
        cost: usage,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) {
        // eslint-disable-next-line no-console
        console.warn(`[RCAEngine] LLM ${err.provider} failed [${err.code}]; using heuristic`);
      }
      return {
        hypothesis: this.buildHeuristicHypothesis(ctx),
        causalChain: this.buildHeuristicCausalChain(ctx, evidence),
        confidence: this.scoreConfidence(evidence),
        alternatives: this.buildHeuristicAlternatives(ctx),
        cost: zeroUsage(),
      };
    }
  }

  /**
   * Pick 2 plausible alternative hypotheses from neighbouring bug types.
   * Heuristic but useful — many bug types share symptoms (e.g., race condition
   * looks like data inconsistency from outside the server).
   */
  private buildHeuristicAlternatives(ctx: RCAContext): AlternativeHypothesis[] {
    const neighbors: Record<BugType, BugType[]> = {
      race_condition: ['data_inconsistency', 'persistence_failure'],
      persistence_failure: ['race_condition', 'realtime_sync_failure'],
      realtime_sync_failure: ['visibility_failure', 'persistence_failure'],
      data_inconsistency: ['race_condition', 'visibility_failure'],
      order_violation: ['realtime_sync_failure', 'data_inconsistency'],
      visibility_failure: ['realtime_sync_failure', 'data_inconsistency'],
      unknown: ['race_condition', 'realtime_sync_failure'],
    };
    const alternativeTypes = neighbors[ctx.bug.type as BugType] ?? neighbors.unknown;
    return alternativeTypes.map((altType, i) => {
      const altBug = { ...ctx, bug: { ...ctx.bug, type: altType } };
      const hypothesis = this.buildHeuristicHypothesis(altBug);
      return {
        rank: i + 2,
        rootCause: hypothesis.rootCause,
        description: hypothesis.description,
        confidence: 0.3 - i * 0.1, // primary is ~0.5, alternatives lower
        rationale: `${altType} shares observable symptoms with ${ctx.bug.type} — investigate if the primary fix doesn't resolve the issue`,
      };
    });
  }

  // ─── Heuristic Fallback ───────────────────────────────────────────────────

  private buildHeuristicHypothesis(ctx: RCAContext): { rootCause: string; description: string } {
    const inferences: Record<BugType, { rootCause: string; description: string }> = {
      race_condition: {
        rootCause: 'Concurrent writes to shared state without serialization',
        description: `Multiple agents wrote to the same resource within a narrow time window without a database transaction or mutex, causing one or more writes to be lost or corrupted.`,
      },
      persistence_failure: {
        rootCause: 'Write not awaited before subsequent read',
        description: `The server returned a success response before the database write committed. A concurrent read therefore observed the pre-write state, creating a temporary inconsistency that may be permanent if not retried.`,
      },
      realtime_sync_failure: {
        rootCause: 'WebSocket broadcast dropped under concurrent write load',
        description: `A write completed successfully but the corresponding pub/sub broadcast failed to reach all subscribers. This may be caused by the subscriber joining after the publish, or by a message queue backpressure event.`,
      },
      data_inconsistency: {
        rootCause: 'Cache not invalidated after write',
        description: `State diverged between the cache and the database. Concurrent writers updated the database but the cache TTL had not expired, causing subsequent readers to see stale data.`,
      },
      order_violation: {
        rootCause: 'Items sorted by client-supplied timestamp instead of server timestamp',
        description: `Clients submitted events with their local wall-clock time. Because client clocks can be skewed or out of order, the resulting list is ordered incorrectly relative to server-side event ingestion.`,
      },
      visibility_failure: {
        rootCause: 'Write not broadcast to all connected subscribers',
        description: `A write succeeded on the server but the pub/sub fan-out to connected WebSocket clients was incomplete. Clients that were connected at write time did not receive the update event.`,
      },
      unknown: {
        rootCause: 'Insufficient evidence to determine root cause',
        description: `The available evidence does not point to a specific failure mode. Additional instrumentation — structured logging, request tracing, and metric collection — is required to isolate the cause.`,
      },
    };

    return inferences[ctx.bug.type as BugType] ?? inferences.unknown;
  }

  private buildHeuristicCausalChain(ctx: RCAContext, evidence: RCAEvidence[]): CausalLink[] {
    const chain: CausalLink[] = [
      {
        step: 1,
        description: `Concurrent agents triggered action: ${ctx.bug.title}`,
        type: 'observation',
      },
    ];

    if (evidence.length > 0) {
      chain.push({
        step: 2,
        description: `${evidence.length} evidence piece${evidence.length !== 1 ? 's' : ''} collected during test`,
        type: 'observation',
      });
    }

    chain.push({
      step: chain.length + 1,
      description: this.buildHeuristicHypothesis(ctx).rootCause,
      type: 'inference',
    });

    chain.push({
      step: chain.length + 1,
      description: `Observable symptom: ${ctx.bug.description}`,
      type: 'conclusion',
    });

    return chain;
  }

  private scoreConfidence(evidence: RCAEvidence[]): number {
    let score = 0.35;
    score += Math.min(0.35, evidence.length * 0.07);
    const avgWeight = evidence.length
      ? evidence.reduce((s, e) => s + e.weight, 0) / evidence.length
      : 0;
    score += avgWeight * 0.3;
    return Math.min(1, score);
  }

  // ─── Recommendations ──────────────────────────────────────────────────────

  private buildRecommendations(ctx: RCAContext): RCARecommendation[] {
    const fixes: Record<BugType, RCARecommendation[]> = {
      race_condition: [
        {
          priority: 'high',
          action:
            'Wrap the conflicting writes in a database transaction with SELECT FOR UPDATE or an advisory lock',
          estimatedImpact: 'Eliminates lost updates under concurrent load',
        },
        {
          priority: 'medium',
          action:
            'Implement optimistic locking with a version column — reject stale writes at the application layer',
          estimatedImpact: 'Reduces contention and surfaces conflicts early',
        },
      ],
      persistence_failure: [
        {
          priority: 'high',
          action:
            'Ensure all write responses are sent only after the database operation commits (await db.insert/update)',
          estimatedImpact: 'Closes the read-your-writes gap',
        },
        {
          priority: 'medium',
          action:
            'Add idempotency keys to write endpoints so clients can safely retry failed requests',
          estimatedImpact: 'Prevents duplicate writes on retry',
        },
      ],
      realtime_sync_failure: [
        {
          priority: 'high',
          action:
            'Move the WebSocket broadcast inside the database transaction so it fires atomically with the write',
          estimatedImpact: 'Prevents missed broadcasts',
        },
        {
          priority: 'medium',
          action: 'Add message delivery acknowledgment with a replay window for reconnecting clients',
          estimatedImpact: 'Recovers from dropped events',
        },
      ],
      data_inconsistency: [
        {
          priority: 'high',
          action:
            'Invalidate the cache key immediately after a successful write using DEL or cache-aside eviction',
          estimatedImpact: 'Eliminates stale reads',
        },
        {
          priority: 'medium',
          action: 'Switch to write-through caching so the cache is always consistent with the database',
          estimatedImpact: 'Keeps cache warm without staleness',
        },
      ],
      order_violation: [
        {
          priority: 'high',
          action:
            'Add a server-assigned sequence column (BIGSERIAL or ULID) and ORDER BY it on all list queries',
          estimatedImpact: 'Gives stable, causal ordering',
        },
        {
          priority: 'medium',
          action: 'Reject client-supplied timestamps as ordering keys — use server receipt time instead',
          estimatedImpact: 'Eliminates clock-skew ordering bugs',
        },
      ],
      visibility_failure: [
        {
          priority: 'high',
          action:
            'Use a message broker (Redis Streams, SQS) to decouple the write path from the broadcast path',
          estimatedImpact: 'Guarantees at-least-once delivery to all subscribers',
        },
        {
          priority: 'medium',
          action:
            'Implement a missed-event catchup API so newly connected clients can request events from a cursor',
          estimatedImpact: 'Handles join-after-publish race',
        },
      ],
      unknown: [
        {
          priority: 'medium',
          action: 'Add structured request tracing (OpenTelemetry spans) to all write and read paths',
          estimatedImpact: 'Provides the evidence needed for a definitive root cause',
        },
        {
          priority: 'low',
          action:
            'Reproduce the test with verbose logging and capture all concurrent request timelines',
          estimatedImpact: 'Isolates the specific failure window',
        },
      ],
    };

    return fixes[ctx.bug.type as BugType] ?? fixes.unknown;
  }
}
