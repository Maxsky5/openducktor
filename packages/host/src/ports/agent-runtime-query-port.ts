import type { AgentSessionLiveRef, AgentRuntimeCatalog } from "@openducktor/contracts";
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

type NativeQueryResponse<Method extends keyof NativeAgentRuntimeQueries> = Awaited<
  ReturnType<NativeAgentRuntimeQueries[Method]>
>;

/** Effect-returning native reads. Adapter results keep their native causes. */
export type NativeAgentRuntimeQueryPort = {
  readonly [Method in keyof NativeAgentRuntimeQueries]: (
    input: Parameters<NativeAgentRuntimeQueries[Method]>[0],
  ) => Effect.Effect<NativeQueryResponse<Method>, RuntimeQueryError>;
};

type HostQueryResponse<Method extends keyof NativeAgentRuntimeQueries> =
  Method extends "loadRuntimeCatalog" ? AgentRuntimeCatalog : NativeQueryResponse<Method>;

/** Application reads. The catalog response carries user-facing surface messages. */
export type AgentRuntimeQueryPort = {
  readonly [Method in keyof NativeAgentRuntimeQueries]: (
    input: Parameters<NativeAgentRuntimeQueries[Method]>[0],
  ) => Effect.Effect<HostQueryResponse<Method>, RuntimeQueryError>;
};

export type AgentRuntimeQueryAdapterPort = NativeAgentRuntimeQueryPort & {
  readonly resolveSessionParent: (
    input: AgentSessionLiveRef,
  ) => Effect.Effect<string | null, RuntimeQueryError>;
};
