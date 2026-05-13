/**
 * Scenario Orchestrator — state machine that runs:
 *   plan (Planner) → loop[ execute (Executor) → heal? (Healer) ] → done
 *
 * Emits live events on EventEmitter so the API route can stream them
 * to WebSocket clients. Holds at most one ExecutorAgent per run; ensures
 * cleanup in dispose() / on every error path.
 *
 * Heal attempts are capped to prevent infinite loops on truly broken steps.
 */

import { EventEmitter } from 'events';
import { logger } from '../../../../shared/lib/logger.js';
import type {
  ScenarioConfig,
  ScenarioRunSummary,
  ScenarioStatus,
  ScenarioEvent,
  StepResult,
  HealAttempt,
} from './types.js';
import { generateTestPlan } from './plannerAgent.js';
import { captureDomSnapshot } from './domSnapshot.js';
import { ExecutorAgent } from './executorAgent.js';
import { healStep } from './healerAgent.js';
import { generateScenarioFailureNarrative } from '../narrative.js';

const MAX_HEAL_ATTEMPTS_PER_STEP = 2;

// ─── Public API ───────────────────────────────────────────────────────────────

export declare interface ScenarioOrchestrator {
  on(event: 'event', listener: (e: ScenarioEvent) => void): this;
  emit(event: 'event', e: ScenarioEvent): boolean;
}

export class ScenarioOrchestrator extends EventEmitter {
  private aborted = false;
  private executor: ExecutorAgent | null = null;

  abort(): void {
    this.aborted = true;
  }

  async run(runId: string, config: ScenarioConfig): Promise<ScenarioRunSummary> {
    const startedAt = Date.now();
    const maxSteps = config.maxSteps ?? 30;
    const allowHealing = config.allowHealing ?? true;

    const summary: ScenarioRunSummary = {
      runId,
      goal: config.goal,
      targetUrl: config.targetUrl,
      status: 'planning',
      plan: null,
      steps: [],
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      healedSteps: 0,
    };

    // ── Phase 1: DOM Snapshot + Plan ─────────────────────────────────────────
    this._emit({ type: 'planning' });

    // Capture real DOM elements so Planner generates accurate locators.
    // Best-effort — if this fails, Planner proceeds without a snapshot.
    const domSnapshot = await captureDomSnapshot(config.targetUrl).catch((err) => {
      logger.warn({ err, runId }, 'DOM snapshot skipped');
      return [];
    });

    try {
      summary.plan = await generateTestPlan(config.goal, config.targetUrl, config.llm, domSnapshot);
      this._emit({ type: 'plan_ready', plan: summary.plan });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, runId }, 'Planner failed');
      return this._finish(summary, 'error', message);
    }

    if (summary.plan.steps.length === 0) {
      return this._finish(summary, 'error', 'Planner returned no executable steps');
    }
    summary.totalSteps = summary.plan.steps.length;

    // ── Phase 2: Execute (with optional healing) ─────────────────────────────
    summary.status = 'running';
    this.executor = new ExecutorAgent({
      stepTimeoutMs: config.stepTimeoutMs,
      headless: config.headless ?? true,
      storageStatePath: config.storageStatePath,
    });

    try {
      await this.executor.start();

      const stepsToRun = summary.plan.steps.slice(0, maxSteps);
      for (const step of stepsToRun) {
        if (this.aborted) {
          return this._finish(summary, 'aborted', 'Aborted by user');
        }
        this._emit({ type: 'step_start', step });

        // First attempt
        let result = await this.executor.runStep(step);

        // Heal if failed
        if (result.status === 'failed' && allowHealing && config.llm.provider !== 'none') {
          const healAttempts: HealAttempt[] = [];
          for (let attempt = 0; attempt < MAX_HEAL_ATTEMPTS_PER_STEP; attempt++) {
            if (this.aborted) break;
            this._emit({ type: 'healing', stepIndex: step.index, reason: result.error ?? 'unknown' });

            const heal = await healStep(
              {
                step,
                failedAction: result.step.action,
                errorMessage: result.error ?? 'unknown',
                page: this.executor.getPage(),
              },
              config.llm,
            );
            healAttempts.push(heal);

            // If healer couldn't propose a new action, give up
            if (!heal.proposedAction || heal.ledToError) break;

            // Retry with the proposed action
            const retry = await this.executor.runStep(step, heal.proposedAction);
            if (retry.status === 'passed') {
              heal.succeeded = true;
              result = {
                ...retry,
                status: 'healed',
                healAttempts,
              };
              break;
            }
            // Retry also failed — loop or give up
            result = { ...retry, healAttempts };
          }
        }

        // Tally
        switch (result.status) {
          case 'passed':
            summary.passedSteps++;
            break;
          case 'healed':
            summary.healedSteps++;
            summary.passedSteps++;
            break;
          case 'failed':
            summary.failedSteps++;
            break;
        }

        summary.steps.push(result);
        this._emit({ type: 'step_end', result });

        // Stop on first hard failure (after healing exhausted).
        // Best-effort: ask the LLM for an app-fix narrative before returning.
        if (result.status === 'failed') {
          // Best-effort: ask the LLM for an app-fix narrative before returning.
          // narrative.ts currently supports claude/groq; ollama support can be
          // added later. For ollama, we skip silently.
          if (config.llm.provider === 'claude' || config.llm.provider === 'groq') {
            try {
              const narrative = await generateScenarioFailureNarrative(
                {
                  goal: config.goal,
                  failedStep: result,
                  healAttempts: result.healAttempts ?? [],
                },
                {
                  provider: config.llm.provider,
                  apiKey: config.llm.apiKey,
                  model: config.llm.model,
                },
              );
              if (narrative) summary.failureNarrative = narrative;
            } catch (err) {
              logger.warn({ err, runId }, 'Failure narrative generation threw');
            }
          }
          return this._finish(summary, 'failed');
        }
      }

      // All steps passed (or healed)
      return this._finish(summary, 'passed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, runId }, 'Orchestrator unhandled error');
      return this._finish(summary, 'error', message);
    } finally {
      await this.executor?.dispose().catch(() => {});
      this.executor = null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private _emit(event: ScenarioEvent): void {
    try {
      this.emit('event', event);
    } catch (err) {
      logger.warn({ err }, 'Listener threw on scenario event');
    }
  }

  private _finish(
    summary: ScenarioRunSummary,
    status: ScenarioStatus,
    errorMessage?: string,
  ): ScenarioRunSummary {
    summary.status = status;
    summary.finishedAt = Date.now();
    summary.durationMs = summary.finishedAt - summary.startedAt;
    if (errorMessage) summary.errorMessage = errorMessage;
    this._emit({ type: 'done', summary });
    return summary;
  }
}
