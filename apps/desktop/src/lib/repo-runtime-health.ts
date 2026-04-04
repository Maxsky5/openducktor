import type { RepoRuntimeHealthCheck, RepoRuntimeHealthProgress } from "@/types/diagnostics";

export const formatRepoRuntimeElapsed = (elapsedMs: number | null): string | null => {
  if (elapsedMs === null) {
    return null;
  }

  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)}s`;
};

export const formatRepoRuntimeObservation = (
  observation: RepoRuntimeHealthProgress["observation"],
): string | null => {
  switch (observation) {
    case "observed_existing_runtime":
      return "Observed existing runtime";
    case "observing_existing_startup":
      return "Observed startup already in progress";
    case "started_by_diagnostics":
      return "Startup initiated by diagnostics";
    case "restarted_for_mcp":
      return "Runtime restarted after MCP status failure";
    case "restart_skipped_active_run":
      return "Restart skipped because an active run is using the runtime";
    case null:
      return null;
  }
};

const describeStage = (
  runtimeLabel: string,
  progress: RepoRuntimeHealthProgress,
): string | null => {
  const elapsed = formatRepoRuntimeElapsed(progress.elapsedMs);
  const elapsedSuffix = elapsed ? ` after ${elapsed}` : "";
  const attemptsSuffix = progress.attempts !== null ? ` (${progress.attempts} attempts)` : "";

  switch (progress.stage) {
    case "idle":
      return null;
    case "startup_requested":
      return `${runtimeLabel} runtime startup requested${elapsedSuffix}.`;
    case "waiting_for_runtime":
      return `${runtimeLabel} runtime is starting and OpenDucktor is waiting for local reachability${elapsedSuffix}${attemptsSuffix}.`;
    case "runtime_ready":
      return `${runtimeLabel} runtime is reachable.`;
    case "checking_mcp_status":
      return `${runtimeLabel} runtime is reachable. Checking OpenDucktor MCP${elapsedSuffix}.`;
    case "reconnecting_mcp":
      return `${runtimeLabel} runtime is reachable. Reconnecting OpenDucktor MCP${elapsedSuffix}.`;
    case "restarting_runtime":
      return `Restarting ${runtimeLabel} runtime after MCP status failure${elapsedSuffix}.`;
    case "restart_skipped_active_run":
      return `Automatic ${runtimeLabel} runtime restart was skipped because an active run is using it.`;
    case "ready":
      return `${runtimeLabel} runtime and OpenDucktor MCP are ready.`;
    case "startup_failed":
      return progress.detail ?? `${runtimeLabel} runtime startup failed.`;
    case "frontend_observation_timeout":
      return `Frontend diagnostics timed out while observing ${runtimeLabel} runtime health.`;
  }
};

export const describeRepoRuntimeProgress = (
  runtimeLabel: string,
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  const progress = runtimeHealth?.progress;
  if (!progress) {
    return null;
  }

  const stageDescription = describeStage(runtimeLabel, progress);
  const timeoutKind = runtimeHealth?.runtimeFailureKind ?? runtimeHealth?.mcpFailureKind ?? null;
  if (timeoutKind === "timeout" && stageDescription) {
    return `Frontend diagnostics timed out while this stage was still in progress. ${stageDescription}`;
  }

  return stageDescription;
};
