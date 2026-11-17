import type { AgentSessionLiveRef, AgentRuntimeCatalog } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentSessionHistoryPort,
  AgentWorkspaceInspectionPort,
  UsageLimitRecovery,
  UsageLimitStop,
} from "@openducktor/core";
import type { Effect } from "effect";
import type { RuntimeQueryError } from "./runtime-query-error";

export type NativeAgentRuntimeQueries = AgentCatalogPort &
  AgentSessionHistoryPort &
  AgentWorkspaceInspectionPort;

type NativeQueryResponse<Method extends keyof NativeAgentRuntimeQueries> = Awaited<
  ReturnType<NativeAgentRuntimeQueries[Method]>
>;

/** Native reads as Effects. Failures keep the adapter cause. */
export type NativeAgentRuntimeQueryPort = {
  readonly [Method in keyof NativeAgentRuntimeQueries]: (
    input: Parameters<NativeAgentRuntimeQueries[Method]>[0],
  ) => Effect.Effect<NativeQueryResponse<Method>, RuntimeQueryError>;
};

type HostQueryResponse<Method extends keyof NativeAgentRuntimeQueries> =
  Method extends "loadRuntimeCatalog" ? AgentRuntimeCatalog : NativeQueryResponse<Method>;

type HostQueries = {
  readonly [Method in keyof NativeAgentRuntimeQueries]: (
    input: Parameters<NativeAgentRuntimeQueries[Method]>[0],
  ) => Effect.Effect<HostQueryResponse<Method>, RuntimeQueryError>;
};

/** Application reads. Catalog failures carry user-facing messages. */
export type AgentRuntimeQueryPort = HostQueries;

export type AgentRuntimeQueryAdapterPort = NativeAgentRuntimeQueryPort & {
  readonly resolveSessionParent: (
    input: AgentSessionLiveRef,
  ) => Effect.Effect<string | null, RuntimeQueryError>;
  /**
   * Reads the usage-limit stop of the latest turn of a root session from runtime history, or
   * `null`. A runtime without `supportsUsageLimitAutoResume` fails with `unsupported_operation`.
   */
  readonly readLatestUsageLimitStop: (
    input: AgentSessionLiveRef,
  ) => Effect.Effect<UsageLimitStop | null, RuntimeQueryError>;
  /**
   * Reads, just before an automatic resume, whether the account can work again. A runtime
   * without `supportsUsageLimitAutoResume` fails with `unsupported_operation`.
   */
  readonly readUsageLimitRecovery: (
    input: AgentSessionLiveRef,
  ) => Effect.Effect<UsageLimitRecovery, RuntimeQueryError>;
};
