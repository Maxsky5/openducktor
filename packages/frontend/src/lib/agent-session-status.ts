import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentSessionStatus = AgentSessionState["status"];

export const isAgentSessionWorkingStatus = (status: AgentSessionStatus): boolean =>
  status === "starting" || status === "running";
