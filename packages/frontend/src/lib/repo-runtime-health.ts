import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
  RepoRuntimeHealthObservation,
} from "@/types/diagnostics";

type RuntimeHealthBadge = {
  label: string;
  variant: "success" | "warning" | "danger" | "secondary";
};

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

export const getRepoRuntimeBadge = (
  runtimeHealth: RepoRuntimeHealthCheck | null,
): RuntimeHealthBadge => {
  const runtimeStatus = runtimeHealth?.runtime.status;
  switch (runtimeStatus) {
    case "disabled":
      return { label: "Disabled", variant: "secondary" };
    case "ready":
      return { label: "Running", variant: "success" };
    case "checking":
      return { label: "Starting", variant: "warning" };
    case "error":
      return { label: "Unavailable", variant: "danger" };
    case "not_started":
      return { label: "Not started", variant: "secondary" };
    default:
      return { label: "Checking", variant: "secondary" };
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

  if (runtimeHealth.runtime.status === "not_started") {
    return runtimeHealth.runtime.detail ?? `${runtimeLabel} runtime has not been started yet.`;
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

export type RepoRuntimeReadinessState = "ready" | "checking" | "blocked";

export type RepoRuntimeReadinessSnapshot = {
  readinessState: RepoRuntimeReadinessState;
  isReady: boolean;
  isRuntimeStarting: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
};

export type RepoRuntimeReadinessTarget =
  | { kind: "all" }
  | { kind: "runtime"; runtimeKind: RuntimeKind }
  | { kind: "resolving" }
  | { kind: "inactive" };

export const allRepoRuntimeReadinessTarget = {
  kind: "all",
} satisfies RepoRuntimeReadinessTarget;

export const resolvingRepoRuntimeReadinessTarget = {
  kind: "resolving",
} satisfies RepoRuntimeReadinessTarget;

export const inactiveRepoRuntimeReadinessTarget = {
  kind: "inactive",
} satisfies RepoRuntimeReadinessTarget;

export const repoRuntimeReadinessTargetForRuntime = (
  runtimeKind: RuntimeKind | null | undefined,
): RepoRuntimeReadinessTarget => {
  if (!runtimeKind) {
    return allRepoRuntimeReadinessTarget;
  }

  return { kind: "runtime", runtimeKind };
};

type DeriveRepoRuntimeReadinessArgs = {
  hasActiveWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

const getBlockedRuntimeReason = (
  runtimeLabel: string,
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  if (!runtimeHealth) {
    return null;
  }
  return describeRepoRuntimeStatus(runtimeLabel, runtimeHealth);
};

const findRuntimeDefinition = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
): RuntimeDescriptor | null => {
  if (!runtimeKind) {
    return null;
  }
  return runtimeDefinitions.find((definition) => definition.kind === runtimeKind) ?? null;
};

export const deriveRepoRuntimeReadiness = ({
  hasActiveWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  runtimeTarget = allRepoRuntimeReadinessTarget,
}: DeriveRepoRuntimeReadinessArgs): RepoRuntimeReadinessSnapshot => {
  if (runtimeTarget.kind === "inactive") {
    if (!hasActiveWorkspace) {
      return {
        readinessState: "blocked",
        isReady: false,
        isRuntimeStarting: false,
        blockedReason: "Select a repository to use agent chat.",
        isLoadingChecks,
      };
    }

    return {
      readinessState: "ready",
      isReady: true,
      isRuntimeStarting: false,
      blockedReason: null,
      isLoadingChecks,
    };
  }

  const runtimeKind = runtimeTarget.kind === "runtime" ? runtimeTarget.runtimeKind : null;
  const isResolvingRuntimeTarget = runtimeTarget.kind === "resolving";
  const targetRuntimeDefinition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  const scopedRuntimeDefinitions = targetRuntimeDefinition
    ? [targetRuntimeDefinition]
    : runtimeKind
      ? []
      : runtimeDefinitions;
  const isRuntimeHealthPending =
    hasActiveWorkspace &&
    scopedRuntimeDefinitions.length > 0 &&
    scopedRuntimeDefinitions.some(
      (definition) => runtimeHealthByRuntime[definition.kind] === undefined,
    );
  const healthyRuntimeDefinition =
    scopedRuntimeDefinitions.find((definition) =>
      isRepoRuntimeReady(runtimeHealthByRuntime[definition.kind] ?? null),
    ) ?? null;
  const checkingRuntimeDefinition =
    scopedRuntimeDefinitions.find(
      (definition) => runtimeHealthByRuntime[definition.kind]?.status === "checking",
    ) ?? null;
  const blockedRuntimeDefinition =
    scopedRuntimeDefinitions.find((definition) => {
      const runtimeHealth = runtimeHealthByRuntime[definition.kind];
      return Boolean(
        runtimeHealth && runtimeHealth.status !== "ready" && runtimeHealth.status !== "checking",
      );
    }) ?? null;
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;
  const isReady = Boolean(
    hasActiveWorkspace && !isResolvingRuntimeTarget && healthyRuntimeDefinition,
  );
  const isRuntimeStarting =
    hasActiveWorkspace &&
    scopedRuntimeDefinitions.some((definition) =>
      isRepoRuntimeStarting(runtimeHealthByRuntime[definition.kind] ?? null),
    );
  const readinessState: RepoRuntimeReadinessState = (() => {
    if (isReady) {
      return "ready";
    }
    if (hasActiveWorkspace && isResolvingRuntimeTarget) {
      return "checking";
    }
    if (hasActiveWorkspace && checkingRuntimeDefinition) {
      return "checking";
    }
    if (
      hasActiveWorkspace &&
      (isLoadingRuntimeDefinitions || isLoadingChecks || isRuntimeHealthPending)
    ) {
      return "checking";
    }

    return "blocked";
  })();
  const blockedReason = (() => {
    if (isReady) {
      return null;
    }
    if (!hasActiveWorkspace) {
      return "Select a repository to use agent chat.";
    }
    if (runtimeDefinitionsError) {
      return runtimeDefinitionsError;
    }
    if (isLoadingRuntimeDefinitions) {
      return "Loading runtime definitions...";
    }
    if (isResolvingRuntimeTarget) {
      return "Resolving selected agent runtime...";
    }
    if (runtimeKind && !targetRuntimeDefinition) {
      return `Runtime '${runtimeKind}' is not available for agent chat.`;
    }
    if (isLoadingChecks || isRuntimeHealthPending) {
      if (checkingRuntimeDefinition) {
        return (
          getBlockedRuntimeReason(
            checkingRuntimeDefinition.label,
            runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
          ) ?? "Checking runtime health..."
        );
      }
      return blockedRuntimeDefinition
        ? (getBlockedRuntimeReason(blockedRuntimeDefinition.label, blockedRuntimeHealth) ??
            "Checking runtime health...")
        : "Checking runtime health...";
    }
    if (checkingRuntimeDefinition) {
      return (
        getBlockedRuntimeReason(
          checkingRuntimeDefinition.label,
          runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
        ) ?? "Checking runtime health..."
      );
    }

    return (
      (blockedRuntimeDefinition
        ? getBlockedRuntimeReason(blockedRuntimeDefinition.label, blockedRuntimeHealth)
        : null) ??
      (runtimeDefinitions.length === 0
        ? "No agent runtimes are available."
        : "No configured runtime is ready for agent chat.")
    );
  })();

  return {
    readinessState,
    isReady,
    isRuntimeStarting,
    blockedReason,
    isLoadingChecks,
  };
};
