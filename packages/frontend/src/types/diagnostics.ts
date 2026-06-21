import type {
  FailureKind,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthState,
  RepoRuntimeMcpStatus,
  RepoRuntimeStartupStatus,
  RuntimeDescriptor,
  RuntimeKind,
  RepoRuntimeHealthCheck as SharedRepoRuntimeHealthCheck,
  RepoRuntimeHealthMcp as SharedRepoRuntimeHealthMcp,
  RepoRuntimeHealthRuntime as SharedRepoRuntimeHealthRuntime,
} from "@openducktor/contracts";

export type RepoRuntimeFailureKind = FailureKind | null;

export type {
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthState,
  RepoRuntimeMcpStatus,
  RepoRuntimeStartupStatus,
};

export type RepoRuntimeDiagnosticInstance = {
  kind: RuntimeKind;
  repoPath: string;
  taskId: string | null;
  role: "workspace";
  workingDirectory: string;
  startedAt: string;
  descriptor: RuntimeDescriptor;
};

export type RepoRuntimeHealthRuntime = Omit<
  SharedRepoRuntimeHealthRuntime,
  "instance" | "observation"
> & {
  observation: RepoRuntimeHealthObservation | null;
  instance: RepoRuntimeDiagnosticInstance | null;
};

export type RepoRuntimeHealthMcp = Omit<SharedRepoRuntimeHealthMcp, "status"> & {
  status: RepoRuntimeMcpStatus;
};

export type RepoRuntimeHealthCheck = Omit<
  SharedRepoRuntimeHealthCheck,
  "status" | "runtime" | "mcp"
> & {
  status: RepoRuntimeHealthState;
  runtime: RepoRuntimeHealthRuntime;
  mcp: RepoRuntimeHealthMcp | null;
};

export type RepoRuntimeHealthMap = Record<string, RepoRuntimeHealthCheck | null>;
