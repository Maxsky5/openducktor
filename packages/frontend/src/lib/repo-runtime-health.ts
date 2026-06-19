import type { RuntimeDescriptor } from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthObservation } from "@/types/diagnostics";

type RuntimeHealthBadge = {
  label: string;
  variant: "success" | "warning" | "danger" | "secondary";
};

export type RepoRuntimeHealthReadiness =
  | "unknown"
  | "ready"
  | "startup_pending"
  | "checking"
  | "blocked";

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
  observation: RepoRuntimeHealthObservation | null,
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
    case "restart_skipped_active_session":
      return "Restart skipped because an active session is using the runtime";
    case null:
      return null;
  }
};

export const buildDisabledRuntimeHealth = (
  definition: RuntimeDescriptor,
): RepoRuntimeHealthCheck => {
  const checkedAt = new Date().toISOString();
  const detail = `${definition.label} runtime is disabled in Agent Runtime settings.`;
  const supportsMcpStatus = definition.capabilities.optionalSurfaces.supportsMcpStatus;

  return {
    status: "disabled",
    checkedAt,
    runtime: {
      status: "disabled",
      stage: "idle",
      observation: null,
      instance: null,
      startedAt: null,
      updatedAt: checkedAt,
      elapsedMs: null,
      attempts: null,
      detail,
      failureKind: null,
      failureReason: null,
    },
    mcp: supportsMcpStatus
      ? {
          supported: true,
          status: "unsupported",
          serverName: ODT_MCP_SERVER_NAME,
          serverStatus: null,
          toolIds: [],
          detail: "Runtime is disabled, so MCP is not checked.",
          failureKind: null,
        }
      : null,
  };
};

export const isRepoRuntimeReady = (runtimeHealth: RepoRuntimeHealthCheck | null): boolean => {
  return runtimeHealth?.status === "ready";
};

export const isRepoRuntimeStarting = (runtimeHealth: RepoRuntimeHealthCheck | null): boolean => {
  if (!runtimeHealth) {
    return false;
  }

  return (
    runtimeHealth.runtime.status === "checking" &&
    (runtimeHealth.runtime.stage === "startup_requested" ||
      runtimeHealth.runtime.stage === "waiting_for_runtime")
  );
};

export const isRepoRuntimeStartupPending = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): boolean => {
  if (!runtimeHealth) {
    return false;
  }

  if (runtimeHealth.status === "not_started") {
    return true;
  }

  return runtimeHealth.runtime.status === "not_started" || isRepoRuntimeStarting(runtimeHealth);
};

export const classifyRepoRuntimeHealth = (
  runtimeHealth: RepoRuntimeHealthCheck | null | undefined,
): RepoRuntimeHealthReadiness => {
  if (!runtimeHealth) {
    return "unknown";
  }

  if (isRepoRuntimeReady(runtimeHealth)) {
    return "ready";
  }

  if (isRepoRuntimeStartupPending(runtimeHealth)) {
    return "startup_pending";
  }

  if (runtimeHealth.status === "checking") {
    return "checking";
  }

  return "blocked";
};

export const isRepoRuntimeHealthPendingReadiness = (
  runtimeHealth: RepoRuntimeHealthCheck | null | undefined,
): boolean => {
  const readiness = classifyRepoRuntimeHealth(runtimeHealth);
  return readiness === "startup_pending" || readiness === "checking";
};

export const getRepoRuntimeBadge = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): RuntimeHealthBadge => {
  switch (classifyRepoRuntimeHealth(runtimeHealth)) {
    case "unknown":
      return { label: "Checking", variant: "secondary" };
    case "ready":
      return { label: "Running", variant: "success" };
    case "startup_pending":
    case "checking":
      return { label: "Starting", variant: "warning" };
    case "blocked":
      return runtimeHealth?.runtime.status === "disabled"
        ? { label: "Disabled", variant: "secondary" }
        : { label: "Unavailable", variant: "danger" };
  }
};

export const getRepoRuntimeMcpBadge = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): RuntimeHealthBadge => {
  const mcpStatus = runtimeHealth?.mcp?.status;
  switch (mcpStatus) {
    case "connected":
      return { label: "Connected", variant: "success" };
    case "checking":
      return { label: "Checking", variant: "secondary" };
    case "reconnecting":
      return { label: "Reconnecting", variant: "warning" };
    case "waiting_for_runtime":
      return { label: "Waiting on runtime", variant: "warning" };
    case "error":
      return { label: "Unavailable", variant: "danger" };
    case "unsupported":
      return { label: "Unsupported", variant: "secondary" };
    default:
      return { label: "Checking", variant: "secondary" };
  }
};

export const getRepoRuntimeMcpStatusLabel = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string => {
  const mcp = runtimeHealth?.mcp;
  if (!mcp) {
    return "unavailable";
  }
  if (mcp.serverStatus) {
    return mcp.serverStatus;
  }

  return mcp.status.replaceAll("_", " ");
};

export const getRepoRuntimeMcpActivity = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  switch (runtimeHealth?.mcp?.status) {
    case "checking":
      return "Checking server status";
    case "reconnecting":
      return "Reconnecting server";
    case "waiting_for_runtime":
      return "Waiting for runtime startup";
    default:
      return null;
  }
};

export const describeRepoRuntimeStatus = (
  runtimeLabel: string,
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  if (!runtimeHealth) {
    return null;
  }

  const runtimeElapsed = formatRepoRuntimeElapsed(runtimeHealth.runtime.elapsedMs);
  const runtimeAttempts =
    runtimeHealth.runtime.attempts === null ? "" : ` (${runtimeHealth.runtime.attempts} attempts)`;
  const elapsedSuffix = runtimeElapsed ? ` after ${runtimeElapsed}` : "";

  if (isRepoRuntimeStartupPending(runtimeHealth)) {
    return `${runtimeLabel} runtime is starting${elapsedSuffix}${runtimeAttempts}.`;
  }

  if (runtimeHealth.runtime.status === "disabled") {
    return runtimeHealth.runtime.detail ?? `${runtimeLabel} runtime is disabled.`;
  }

  if (runtimeHealth.runtime.status === "checking") {
    switch (runtimeHealth.runtime.stage) {
      case "startup_requested":
        return `${runtimeLabel} runtime startup requested${elapsedSuffix}.`;
      case "waiting_for_runtime":
        return `${runtimeLabel} runtime is starting${elapsedSuffix}${runtimeAttempts}.`;
      case "runtime_ready":
      case "startup_failed":
      case "idle":
        return runtimeHealth.runtime.detail ?? `${runtimeLabel} runtime is still being checked.`;
    }
  }

  if (runtimeHealth.runtime.status === "error") {
    return runtimeHealth.runtime.detail ?? `${runtimeLabel} runtime is unavailable.`;
  }

  const mcp = runtimeHealth.mcp;
  if (!mcp) {
    return `${runtimeLabel} runtime is ready.`;
  }

  switch (mcp.status) {
    case "waiting_for_runtime":
      return `${runtimeLabel} runtime is starting before OpenDucktor MCP can be checked.`;
    case "checking":
      return `Checking OpenDucktor MCP for ${runtimeLabel}.`;
    case "reconnecting":
      return `Reconnecting OpenDucktor MCP for ${runtimeLabel}.`;
    case "error":
      return mcp.detail ?? `${runtimeLabel} OpenDucktor MCP is unavailable.`;
    case "connected":
    case "unsupported":
      return `${runtimeLabel} runtime is ready.`;
  }
};
