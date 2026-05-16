import type {
  FailureKind,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeRoute,
} from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostDependencyError,
  HostOperationError,
  HostPathAccessError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";

export type RuntimeRegistryError =
  | HostDependencyError
  | HostOperationError
  | HostPathAccessError
  | HostResourceError
  | HostValidationError;

export type RuntimeEnsureWorkspaceInput = {
  runtimeKind: string;
  repoPath: string;
  workingDirectory: string;
  descriptor: RuntimeDescriptor;
};
export type RuntimeWorkspaceHandle = {
  runtime: RuntimeInstanceSummary;
  stop(): Effect.Effect<void, HostOperationError>;
};
export type RuntimeWorkspaceStarterPort = {
  startWorkspaceRuntime(
    input: RuntimeEnsureWorkspaceInput,
  ): Effect.Effect<RuntimeWorkspaceHandle, RuntimeRegistryError>;
};
export type RuntimeSessionStopInput = {
  runtimeKind: string;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};
export type RuntimeSessionStatusProbeInput = {
  runtimeKind: string;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};
export type RuntimeMcpStatusProbeInput = {
  runtimeKind: string;
  runtimeRoute: RuntimeRoute;
  workingDirectory: string;
  serverName: string;
};
export type RuntimeMcpStatusProbeResult = {
  supported: boolean;
  connected: boolean;
  serverStatus: string | null;
  toolIds: string[];
  detail: string | null;
  failureKind: FailureKind | null;
};
export type RuntimeRegistryPort = {
  ensureWorkspaceRuntime(
    input: RuntimeEnsureWorkspaceInput,
  ): Effect.Effect<RuntimeInstanceSummary, RuntimeRegistryError>;
  listRuntimes(): Effect.Effect<RuntimeInstanceSummary[], never>;
  stopRuntime(runtimeId: string): Effect.Effect<boolean, HostOperationError | HostResourceError>;
  stopAllRuntimes?(): Effect.Effect<
    RuntimeInstanceSummary[],
    HostOperationError | HostResourceError
  >;
  stopSession(input: RuntimeSessionStopInput): Effect.Effect<void, RuntimeRegistryError>;
  probeSessionStatus?(input: RuntimeSessionStatusProbeInput): Effect.Effect<
    {
      supported: boolean;
      hasLiveSession: boolean;
    },
    RuntimeRegistryError
  >;
  probeMcpStatus?(
    input: RuntimeMcpStatusProbeInput,
  ): Effect.Effect<RuntimeMcpStatusProbeResult, RuntimeRegistryError>;
};

export class RuntimeRegistryPortTag extends Context.Tag("@openducktor/host/RuntimeRegistryPort")<
  RuntimeRegistryPortTag,
  RuntimeRegistryPort
>() {}
