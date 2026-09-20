import type { WorkspaceSessionExternal } from "@openducktor/contracts";
import type {
  ExternalRuntimeSessionsPort as NativePort,
  SessionRef,
  ExternalRuntimeSessionPage,
} from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
export type PreparedExternalSession = {
  metadata: WorkspaceSessionExternal;
  commit: Effect.Effect<void, HostError>;
  dispose: Effect.Effect<void, HostError>;
};
export type ExternalRuntimeSessionsPort = {
  list(
    input: Parameters<NativePort["list"]>[0],
  ): Effect.Effect<ExternalRuntimeSessionPage, HostError>;
  inspect(input: SessionRef): Effect.Effect<WorkspaceSessionExternal, HostError>;
  prepare(input: SessionRef): Effect.Effect<PreparedExternalSession, HostError>;
};
