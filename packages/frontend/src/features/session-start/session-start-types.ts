import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";

export type SessionStartExistingSessionOption = {
  value: string;
  label: string;
  description: string;
  secondaryLabel?: string;
  selectedModel?: AgentModelSelection | null;
};

export type SessionStartRequestReason =
  | "create_session"
  | "composer_send"
  | "scenario_kickoff"
  | "rebase_conflict_resolution";

export type NewSessionStartRequest = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  reason: SessionStartRequestReason;
  selectedModel: AgentModelSelection | null;
  targetWorkingDirectory?: string | null;
  initialTargetBranch?: GitTargetBranch | null;
  initialTargetBranchError?: string | null;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceExternalSessionId?: string | null;
};

export type FreshSessionStartDecision = {
  startMode: "fresh";
  selectedModel: AgentModelSelection;
  targetBranch?: GitTargetBranch;
};

export type ReuseSessionStartDecision = {
  startMode: "reuse";
  sourceExternalSessionId: string;
  targetBranch?: GitTargetBranch;
};

export type ForkSessionStartDecision = {
  startMode: "fork";
  selectedModel: AgentModelSelection;
  sourceExternalSessionId: string;
  targetBranch?: GitTargetBranch;
};

export type NewSessionStartDecision =
  | FreshSessionStartDecision
  | ReuseSessionStartDecision
  | ForkSessionStartDecision
  | null;
