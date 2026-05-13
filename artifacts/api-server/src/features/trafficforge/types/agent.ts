import type { AgentAction, AgentEvent, AgentState } from '../engine/agentExecutor.js';

export type { AgentAction, AgentEvent, AgentState };

export interface AgentConfig {
  id: string;
  role: 'chatter' | 'commenter' | 'monitor';
  timeout?: number;
}

export interface AgentExecutionResult {
  agentId: string;
  role: string;
  success: boolean;
  totalEvents: number;
  failedEvents: number;
  duration: number;
  events: AgentEvent[];
}
