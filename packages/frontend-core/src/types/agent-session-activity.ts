export type AgentSessionActivityState =
  | "waiting_input"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error";

export type ActiveAgentSessionActivityState = Extract<
  AgentSessionActivityState,
  "waiting_input" | "starting" | "running"
>;

export type WorkingAgentSessionActivityState = Extract<
  AgentSessionActivityState,
  "starting" | "running"
>;

export type OptionalAgentSessionActivityState = AgentSessionActivityState | null | undefined;
