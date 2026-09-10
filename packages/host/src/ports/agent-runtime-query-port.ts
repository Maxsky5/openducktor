import type {
  AgentCatalogPort,
  AgentSessionHistoryPort,
  AgentWorkspaceInspectionPort,
} from "@openducktor/core";
import type { Effect } from "effect";
import type { RuntimeQueryError } from "./runtime-query-error";

export type NativeAgentRuntimeQueries = AgentCatalogPort &
  AgentSessionHistoryPort &
  AgentWorkspaceInspectionPort;

/** Passive reads from the same native adapter that owns the runtime's live state. */
export type AgentRuntimeQueryPort = {
  readonly [Method in keyof NativeAgentRuntimeQueries]: (
    input: Parameters<NativeAgentRuntimeQueries[Method]>[0],
  ) => Effect.Effect<Awaited<ReturnType<NativeAgentRuntimeQueries[Method]>>, RuntimeQueryError>;
};

export type AgentRuntimeQueryAdapterPort = AgentRuntimeQueryPort & {
  readonly resolveSessionParent: (
    input: import("@openducktor/contracts").AgentSessionLiveRef,
  ) => Effect.Effect<string | null, RuntimeQueryError>;
};
