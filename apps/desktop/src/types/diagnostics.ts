import type {
  FailureKind,
  RepoRuntimeHealthFailureOrigin,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthStage,
  RepoRuntimeStartupStatus,
  RuntimeInstanceSummary,
  RepoRuntimeHealthCheck as SharedRepoRuntimeHealthCheck,
  RepoRuntimeHealthProgress as SharedRepoRuntimeHealthProgress,
} from "@openducktor/contracts";

export type RepoRuntimeFailureKind = FailureKind | null;

export type {
  RepoRuntimeHealthFailureOrigin,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthStage,
};

export type RepoRuntimeHealthProgress = SharedRepoRuntimeHealthProgress & {
  stage: RepoRuntimeHealthStage;
  observation: RepoRuntimeHealthObservation | null;
  failureOrigin: RepoRuntimeHealthFailureOrigin | null;
  host: RepoRuntimeStartupStatus | null;
};

export type RepoRuntimeHealthCheck = SharedRepoRuntimeHealthCheck & {
  runtimeFailureKind: RepoRuntimeFailureKind;
  runtime: RuntimeInstanceSummary | null;
  mcpFailureKind: RepoRuntimeFailureKind;
  progress?: RepoRuntimeHealthProgress | null | undefined;
};

export type RepoRuntimeHealthMap = Record<string, RepoRuntimeHealthCheck | null>;
