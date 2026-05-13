/**
 * Orchestrator + Claude configuration.
 */

export interface OrchestratorConfig {
  claudeModel: string;
  claudeMaxTokens: number;
  enablePlannerCache: boolean;
  enableReporterCache: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const orchestratorConfig: OrchestratorConfig = {
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001',
  claudeMaxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS ?? '2000', 10),
  enablePlannerCache: process.env.PLANNER_CACHE !== 'false',
  enableReporterCache: process.env.REPORTER_CACHE !== 'false',
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
};
