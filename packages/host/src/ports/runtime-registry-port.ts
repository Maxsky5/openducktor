import type {
  FailureKind,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeRoute,
} from "@openducktor/contracts";

export type RuntimeEnsureWorkspaceInput = {
  runtimeKind: string;
  repoPath: string;
  workingDirectory: string;
  descriptor: RuntimeDescriptor;
};

export type RuntimeWorkspaceHandle = {
  runtime: RuntimeInstanceSummary;
  stop(): Promise<void>;
};

export type RuntimeWorkspaceStarterPort = {
  startWorkspaceRuntime(input: RuntimeEnsureWorkspaceInput): Promise<RuntimeWorkspaceHandle>;
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
  ensureWorkspaceRuntime(input: RuntimeEnsureWorkspaceInput): Promise<RuntimeInstanceSummary>;
  listRuntimes(): Promise<RuntimeInstanceSummary[]>;
  stopRuntime(runtimeId: string): Promise<boolean>;
  stopAllRuntimes?(): Promise<RuntimeInstanceSummary[]>;
  stopSession(input: RuntimeSessionStopInput): Promise<void>;
  probeSessionStatus?(input: RuntimeSessionStatusProbeInput): Promise<{
    supported: boolean;
    hasLiveSession: boolean;
  }>;
  probeMcpStatus?(input: RuntimeMcpStatusProbeInput): Promise<RuntimeMcpStatusProbeResult>;
};
