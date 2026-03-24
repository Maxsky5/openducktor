import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionStartMode,
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

export type NewSessionStartDecision = {
  selectedModel: AgentModelSelection | null;
  startMode: AgentSessionStartMode;
  sourceSessionId: string | null;
} | null;

export type RequestNewSessionStart = (
  request: NewSessionStartRequest,
) => Promise<NewSessionStartDecision>;
