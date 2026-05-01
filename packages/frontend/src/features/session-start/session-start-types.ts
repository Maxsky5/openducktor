import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { SessionLaunchActionId } from "./session-start-launch-options";

export type SessionStartExistingSessionOption = {
  value: string;
  label: string;
  description: string;
  secondaryLabel?: string;
  selectedModel?: AgentModelSelection | null;
};

export type NewSessionStartRequest = {
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
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
