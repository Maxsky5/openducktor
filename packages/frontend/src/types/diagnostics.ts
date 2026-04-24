import type {
  FailureKind,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthState,
  RepoRuntimeMcpStatus,
  RepoRuntimeStartupStatus,
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

export type RepoRuntimeHealthRuntime = SharedRepoRuntimeHealthRuntime & {
  observation: RepoRuntimeHealthObservation | null;
};

export type RepoRuntimeHealthMcp = SharedRepoRuntimeHealthMcp & {
  status: RepoRuntimeMcpStatus;
};

export type RepoRuntimeHealthCheck = SharedRepoRuntimeHealthCheck & {
  status: RepoRuntimeHealthState;
  runtime: RepoRuntimeHealthRuntime;
  mcp: RepoRuntimeHealthMcp | null;
};

export type RepoRuntimeHealthMap = Record<string, RepoRuntimeHealthCheck | null>;
