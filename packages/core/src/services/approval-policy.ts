import type { AgentRole } from "../types/agent-orchestrator";

export const READ_ONLY_AGENT_ROLES = [
  "spec",
  "planner",
  "qa",
] as const satisfies readonly AgentRole[];
export const READ_ONLY_AGENT_ROLE_SET = new Set<AgentRole>(READ_ONLY_AGENT_ROLES);

export const isReadOnlyAgentRole = (role: AgentRole): boolean => READ_ONLY_AGENT_ROLE_SET.has(role);
