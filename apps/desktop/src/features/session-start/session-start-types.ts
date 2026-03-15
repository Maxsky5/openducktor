import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";

export type SessionStartRequestReason =
  | "create_session"
  | "composer_send"
  | "scenario_kickoff"
  | "rebase_conflict_resolution";

export type NewSessionStartRequest = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  reason: SessionStartRequestReason;
  selectedModel: AgentModelSelection | null;
};

export type NewSessionStartDecision = {
  selectedModel: AgentModelSelection | null;
} | null;

export type RequestNewSessionStart = (
  request: NewSessionStartRequest,
) => Promise<NewSessionStartDecision>;
