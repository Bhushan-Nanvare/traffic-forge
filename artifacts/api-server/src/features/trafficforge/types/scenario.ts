import type { AgentAction } from '../engine/agentExecutor.js';

export interface Scenario {
  id: string;
  name: string;
  description: string;
  appType: string;
  agents: ScenarioAgentSpec[];
  expectedOutcomes: string[];
}

export interface ScenarioAgentSpec {
  role: 'chatter' | 'commenter' | 'monitor';
  count: number;
  actions: AgentAction[];
}

export interface PlannerInput {
  url: string;
  appType: string;
  discoveredPaths: string[];
  forms: { type: string; count: number }[];
  features: string[];
}

export interface PlannerOutput {
  scenarios: Scenario[];
  reasoning: string;
}
