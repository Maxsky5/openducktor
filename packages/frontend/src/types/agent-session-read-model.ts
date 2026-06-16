export type AgentSessionReadModelLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string };

export const idleAgentSessionReadModelLoadState: AgentSessionReadModelLoadState = Object.freeze({
  kind: "idle",
});
