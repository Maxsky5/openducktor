import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";

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
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceSessionId?: string | null;
};

export type FreshSessionStartDecision = {
  startMode: "fresh";
  selectedModel: AgentModelSelection;
};

export type ReuseSessionStartDecision = {
  startMode: "reuse";
  sourceSessionId: string;
};

export type ForkSessionStartDecision = {
  startMode: "fork";
  selectedModel: AgentModelSelection;
  sourceSessionId: string;
};

export type NewSessionStartDecision =
  | FreshSessionStartDecision
  | ReuseSessionStartDecision
  | ForkSessionStartDecision
  | null;

export type RequestNewSessionStart = (
  request: NewSessionStartRequest,
) => Promise<NewSessionStartDecision>;
