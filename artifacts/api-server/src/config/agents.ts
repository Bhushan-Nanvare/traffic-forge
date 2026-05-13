/**
 * Agent pool configuration.
 * Controls how many concurrent agents and browsers are spawned.
 */

export interface AgentConfig {
  poolSize: number;
  maxBrowsers: number;
  contextsPerBrowser: number;
  defaultTimeout: number;
  retryAttempts: number;
  headless: boolean;
}

const isDemo = process.env.NODE_ENV !== 'production';

export const agentConfig: AgentConfig = {
  poolSize: isDemo ? 5 : 50,
  maxBrowsers: isDemo ? 3 : 50,
  contextsPerBrowser: isDemo ? 2 : 4,
  defaultTimeout: parseInt(process.env.AGENT_TIMEOUT_MS ?? '15000', 10),
  retryAttempts: parseInt(process.env.AGENT_RETRY ?? '3', 10),
  headless: process.env.HEADLESS !== 'false',
};
