import type {
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionStartMode,
} from "@openducktor/core";

export type SessionStartReusableSessionOption = {
  value: string;
  label: string;
  description: string;
  secondaryLabel?: string;
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
  reusableSessionOptions?: SessionStartReusableSessionOption[];
  initialReusableSessionId?: string | null;
};

export type NewSessionStartDecision = {
  selectedModel: AgentModelSelection | null;
  startMode: AgentSessionStartMode;
  reuseSessionId: string | null;
} | null;

export type RequestNewSessionStart = (
  request: NewSessionStartRequest,
) => Promise<NewSessionStartDecision>;
