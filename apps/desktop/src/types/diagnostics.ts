import type {
  FailureKind,
  RepoRuntimeStartupStatus,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";

export type RepoRuntimeFailureKind = FailureKind | null;

export type RepoRuntimeHealthStage =
  | "idle"
  | "startup_requested"
  | "waiting_for_runtime"
  | "runtime_ready"
  | "checking_mcp_status"
  | "reconnecting_mcp"
  | "restarting_runtime"
  | "restart_skipped_active_run"
  | "ready"
  | "startup_failed"
  | "frontend_observation_timeout";

export type RepoRuntimeHealthObservation =
  | "observed_existing_runtime"
  | "observing_existing_startup"
  | "started_by_diagnostics"
  | "restarted_for_mcp"
  | "restart_skipped_active_run"
  | null;

export type RepoRuntimeHealthProgress = {
  stage: RepoRuntimeHealthStage;
  observation: RepoRuntimeHealthObservation;
  startedAt: string | null;
  updatedAt: string;
  elapsedMs: number | null;
  attempts: number | null;
  detail: string | null;
  failureKind: RepoRuntimeFailureKind;
  failureReason: string | null;
  host: RepoRuntimeStartupStatus | null;
};

export type RepoRuntimeHealthCheck = {
  runtimeOk: boolean;
  runtimeError: string | null;
  runtimeFailureKind: RepoRuntimeFailureKind;
  runtime: RuntimeInstanceSummary | null;
  mcpOk: boolean;
  mcpError: string | null;
  mcpFailureKind: RepoRuntimeFailureKind;
  mcpServerName: string;
  mcpServerStatus: string | null;
  mcpServerError: string | null;
  availableToolIds: string[];
  checkedAt: string;
  errors: string[];
  progress?: RepoRuntimeHealthProgress | null;
};

export type RepoRuntimeHealthMap = Record<string, RepoRuntimeHealthCheck | null>;
