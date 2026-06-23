import type {
  FailureKind,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { Effect } from "effect";
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
  isAlive(): boolean;
  stop(): Effect.Effect<void, HostOperationError>;
};
export type RuntimeWorkspaceStarterPort = {
  startWorkspaceRuntime(
    input: RuntimeEnsureWorkspaceInput,
  ): Effect.Effect<RuntimeWorkspaceHandle, RuntimeRegistryError>;
};
export type RuntimeSessionStopInput = {
  runtimeKind: string;
  repoPath: string;
  externalSessionId: string;
  workingDirectory: string;
};
export type RuntimeSessionStatusProbeInput = {
  runtimeKind: string;
  repoPath: string;
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
  findRuntimeById(runtimeId: string): Effect.Effect<RuntimeInstanceSummary | null, never>;
  findWorkspaceRuntime(input: {
    repoPath: string;
    runtimeKind: string;
  }): Effect.Effect<RuntimeInstanceSummary | null, RuntimeRegistryError>;
  listRuntimes(): Effect.Effect<RuntimeInstanceSummary[], never>;
  listRuntimesByRepo(input: {
    repoPath: string;
    runtimeKind?: string;
  }): Effect.Effect<RuntimeInstanceSummary[], never>;
  stopRuntime(runtimeId: string): Effect.Effect<boolean, HostOperationError | HostResourceError>;
  stopAllRuntimes(): Effect.Effect<
    RuntimeInstanceSummary[],
    HostOperationError | HostResourceError
  >;
  stopSession(input: RuntimeSessionStopInput): Effect.Effect<void, RuntimeRegistryError>;
  probeSessionStatus(input: RuntimeSessionStatusProbeInput): Effect.Effect<
    {
      supported: boolean;
      hasLiveSession: boolean;
    },
    RuntimeRegistryError
  >;
  probeMcpStatus(
    input: RuntimeMcpStatusProbeInput,
  ): Effect.Effect<RuntimeMcpStatusProbeResult, RuntimeRegistryError>;
};
