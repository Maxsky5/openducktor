import type {
  RuntimeCheck,
  RuntimeDescriptor,
  TaskStoreCheck,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import {
  buildDisabledRuntimeHealth,
  classifyRepoRuntimeHealth,
  describeRepoRuntimeStatus,
  formatRepoRuntimeElapsed,
  formatRepoRuntimeObservation,
  getRepoRuntimeBadge,
  getRepoRuntimeMcpActivity,
  getRepoRuntimeMcpBadge,
  getRepoRuntimeMcpStatusLabel,
} from "@/lib/repo-runtime-health";
import {
  getRepoStoreCategoryLabel,
  getRepoStoreDetail,
  getRepoStoreHealth,
  getRepoStoreStatusLabel,
  isRepoStoreReady,
} from "@/lib/repo-store-health";
import {
  hasRuntimeCheckFailure,
  hasTaskStoreCheckFailure,
} from "@/state/operations/workspace/check-diagnostics";
import type { RepoRuntimeFailureKind, RepoRuntimeHealthMap } from "@/types/diagnostics";
import { buildDiagnosticsSummary, type DiagnosticsSummary } from "./diagnostics-model";

export type DiagnosticKeyValueRowModel = {
  label: string;
  value: string;
  mono?: boolean;
  breakAll?: boolean;
  valueClassName?: string;
};

export type DiagnosticsSectionModel = {
  key: string;
  title: string;
  badge: {
    label: string;
    variant: "success" | "warning" | "danger" | "secondary";
  };
  rows: DiagnosticKeyValueRowModel[];
  errors: string[];
  emptyMessage?: string;
};

export type DiagnosticsPanelModel = {
  repoName: string;
  isSummaryChecking: boolean;
  summaryState: DiagnosticsSummary;
  criticalReasons: string[];
  sections: DiagnosticsSectionModel[];
};

type BuildDiagnosticsPanelModelInput = {
  workspaceRepoPath: string | null;
  activeWorkspace: WorkspaceRecord | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeCheck: RuntimeCheck | null;
  taskStoreCheck: TaskStoreCheck | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
};

type RuntimeHealthState = RepoRuntimeHealthMap[string] | undefined;

const getFailureBadge = (
  ok: boolean | null,
  failureKind: RepoRuntimeFailureKind,
  labels: { healthy: string; timeout: string; error: string; checking: string },
): DiagnosticsSectionModel["badge"] => {
  if (ok === null) {
    return { label: labels.checking, variant: "secondary" };
  }
  if (ok) {
    return { label: labels.healthy, variant: "success" };
  }
  if (failureKind === "timeout") {
    return { label: labels.timeout, variant: "warning" };
  }
  return { label: labels.error, variant: "danger" };
};

const buildFailureMessages = ({
  label,
  detail,
  failureKind,
  availabilityVerb,
}: {
  label: string;
  detail: string | null;
  failureKind: RepoRuntimeFailureKind;
  availabilityVerb?: "is" | "are";
}): string[] => {
  if (failureKind === "timeout") {
    const verb = availabilityVerb ?? "is";
    const message = detail
      ? `${label} ${verb} not yet available. Latest detail: ${detail}`
      : `${label} ${verb} not yet available.`;
    return [message];
  }

  return detail ? [detail] : [];
};

const getRepoStoreFailureBadge = (
  taskStoreCheck: TaskStoreCheck | null,
  failureKind: RepoRuntimeFailureKind,
): DiagnosticsSectionModel["badge"] => {
  if (failureKind === "timeout") {
    return { label: "Timed out", variant: "warning" };
  }
  const repoStoreHealth = getRepoStoreHealth(taskStoreCheck);
  if (repoStoreHealth === null) {
    return { label: "Checking", variant: "secondary" };
  }

  switch (repoStoreHealth.status) {
    case "ready":
      return { label: "Ready", variant: "success" };
    case "degraded":
      return { label: "Degraded", variant: "warning" };
    case "blocking":
      return { label: "Blocked", variant: "danger" };
  }
};

const buildRepoStoreRows = (
  taskStoreCheck: TaskStoreCheck | null,
): DiagnosticKeyValueRowModel[] => {
  const repoStoreHealth = getRepoStoreHealth(taskStoreCheck);
  if (!taskStoreCheck || !repoStoreHealth) {
    return [];
  }

  const rows: DiagnosticKeyValueRowModel[] = [
    {
      label: "Status",
      value: getRepoStoreStatusLabel(repoStoreHealth),
    },
    {
      label: "Health category",
      value: getRepoStoreCategoryLabel(repoStoreHealth),
    },
    {
      label: "SQLite database path",
      value: repoStoreHealth.databasePath ?? "Unavailable",
      breakAll: true,
      mono: repoStoreHealth.databasePath !== null,
      valueClassName: "text-muted-foreground",
    },
  ];

  return rows;
};

const buildRepoStoreErrors = (
  taskStoreCheck: TaskStoreCheck | null,
  failureKind: RepoRuntimeFailureKind,
): string[] => {
  if (failureKind === "timeout") {
    const repoStoreHealth = getRepoStoreHealth(taskStoreCheck);
    const errors = buildFailureMessages({
      label: "Task store",
      detail: repoStoreHealth ? getRepoStoreDetail(repoStoreHealth) : null,
      failureKind,
    });
    return errors;
  }

  const repoStoreHealth = getRepoStoreHealth(taskStoreCheck);
  if (!taskStoreCheck || !repoStoreHealth || isRepoStoreReady(repoStoreHealth)) {
    return [];
  }

  const errors = buildFailureMessages({
    label: "Task store",
    detail: getRepoStoreDetail(repoStoreHealth),
    failureKind,
  });
  return errors;
};

const buildRuntimeRows = (runtimeHealth: RuntimeHealthState): DiagnosticKeyValueRowModel[] => {
  if (!runtimeHealth) {
    return [];
  }

  const rows: DiagnosticKeyValueRowModel[] = [];
  const instance = runtimeHealth.runtime.instance;
  if (instance) {
    rows.push({
      label: "Working directory",
      value: instance.workingDirectory,
      breakAll: true,
      valueClassName: "text-muted-foreground",
    });
  }

  if (runtimeHealth.runtime.status !== "ready") {
    rows.push({
      label: runtimeHealth.runtime.status === "disabled" ? "Status" : "Stage",
      value:
        runtimeHealth.runtime.status === "disabled"
          ? "Disabled in Agent Runtime settings"
          : runtimeHealth.runtime.stage.replaceAll("_", " "),
      valueClassName: "text-muted-foreground",
    });

    if (runtimeHealth.runtime.detail) {
      rows.push({
        label: "Detail",
        value: runtimeHealth.runtime.detail,
        valueClassName: "text-muted-foreground",
      });
    }

    const observation = formatRepoRuntimeObservation(runtimeHealth.runtime.observation);
    if (observation) {
      rows.push({
        label: "Observation",
        value: observation,
        valueClassName: "text-muted-foreground",
      });
    }

    const elapsed = formatRepoRuntimeElapsed(runtimeHealth.runtime.elapsedMs);
    if (elapsed) {
      rows.push({
        label: "Elapsed",
        value: elapsed,
        mono: true,
        valueClassName: "text-muted-foreground",
      });
    }

    if (runtimeHealth.runtime.attempts !== null) {
      rows.push({
        label: "Attempts",
        value: String(runtimeHealth.runtime.attempts),
        mono: true,
        valueClassName: "text-muted-foreground",
      });
    }
  }

  return rows;
};

const buildMcpRows = (runtimeHealth: RuntimeHealthState): DiagnosticKeyValueRowModel[] => {
  if (!runtimeHealth?.mcp) {
    return [];
  }

  const rows: DiagnosticKeyValueRowModel[] = [
    {
      label: "Server name",
      value: runtimeHealth.mcp.serverName || ODT_MCP_SERVER_NAME,
      mono: true,
    },
    {
      label: "Status",
      value: getRepoRuntimeMcpStatusLabel(runtimeHealth ?? null),
      valueClassName: runtimeHealth.mcp.serverStatus ? "font-medium" : "text-muted-foreground",
    },
  ];

  if (runtimeHealth.mcp.status === "connected" || runtimeHealth.mcp.toolIds.length > 0) {
    rows.push({
      label: "Tools detected",
      value: String(runtimeHealth.mcp.toolIds.length),
      mono: true,
      valueClassName: "text-muted-foreground",
    });
  }

  const activity = getRepoRuntimeMcpActivity(runtimeHealth ?? null);
  if (activity) {
    rows.push({
      label: "Activity",
      value: activity,
      valueClassName: "text-muted-foreground",
    });
  }

  return rows;
};

const buildRuntimeSectionErrors = (
  runtimeLabel: string,
  runtimeHealth: RuntimeHealthState,
): string[] => {
  const runtime = runtimeHealth?.runtime;
  if (runtime?.status !== "error") {
    return [];
  }

  return buildFailureMessages({
    label: `${runtimeLabel} runtime`,
    detail: runtime.detail ?? `${runtimeLabel} runtime is unavailable.`,
    failureKind: runtime.failureKind ?? "error",
  });
};

const buildMcpSectionErrors = (
  runtimeLabel: string,
  runtimeHealth: RuntimeHealthState,
): string[] => {
  const mcp = runtimeHealth?.mcp;
  if (mcp?.status !== "error") {
    return [];
  }

  const runtime = runtimeHealth?.runtime;
  if (runtime?.status !== "ready") {
    return [];
  }

  return buildFailureMessages({
    label: `${runtimeLabel} OpenDucktor MCP`,
    detail: mcp.detail ?? `${runtimeLabel} OpenDucktor MCP is unavailable.`,
    failureKind: mcp.failureKind ?? "error",
  });
};

const isRuntimeHealthChecking = (runtimeHealth: RuntimeHealthState): boolean => {
  const readiness = classifyRepoRuntimeHealth(runtimeHealth);
  return readiness === "startup_pending" || readiness === "checking";
};

export const buildDiagnosticsPanelModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsPanelModel => {
  const {
    workspaceRepoPath,
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeCheck,
    taskStoreCheck,
    runtimeCheckFailureKind,
    taskStoreCheckFailureKind,
    runtimeHealthByRuntime,
    isLoadingChecks,
  } = input;
  const repoName = workspaceRepoPath?.split("/").filter(Boolean).at(-1) ?? "No repository";
  const effectiveWorktreeBasePath = activeWorkspace?.effectiveWorktreeBasePath ?? null;
  const worktreeAvailable = Boolean(effectiveWorktreeBasePath);
  const runtimeEntries = runtimeDefinitions.map((definition) => {
    const cliHealth =
      runtimeCheck?.runtimes.find((entry) => entry.kind === definition.kind) ?? null;
    return {
      definition,
      cliHealth,
      runtimeHealth:
        runtimeHealthByRuntime[definition.kind] ??
        (cliHealth?.enabled === false ? buildDisabledRuntimeHealth(definition) : undefined),
    };
  });
  const isRuntimeHealthPending = runtimeEntries.some(
    ({ runtimeHealth }) => runtimeHealth === undefined,
  );
  const hasRuntimeHealthChecking = runtimeEntries.some(({ runtimeHealth }) =>
    isRuntimeHealthChecking(runtimeHealth),
  );

  const criticalReasons: string[] = [];
  if (workspaceRepoPath) {
    const repoStoreHealth = getRepoStoreHealth(taskStoreCheck);
    if (runtimeDefinitionsError) {
      criticalReasons.push(runtimeDefinitionsError);
    }
    if (hasRuntimeCheckFailure(runtimeCheck)) {
      criticalReasons.push("Runtime CLI checks failing");
    }
    for (const { definition, runtimeHealth } of runtimeEntries) {
      if (
        runtimeHealth?.status === "error" &&
        classifyRepoRuntimeHealth(runtimeHealth) === "blocked"
      ) {
        criticalReasons.push(
          describeRepoRuntimeStatus(definition.label, runtimeHealth) ??
            `${definition.label} runtime health has an issue.`,
        );
      }
    }
    if (repoStoreHealth && hasTaskStoreCheckFailure(taskStoreCheck)) {
      criticalReasons.push(getRepoStoreDetail(repoStoreHealth));
    }
  }

  const setupReasons: string[] = [];
  if (workspaceRepoPath && !worktreeAvailable) {
    setupReasons.push("Configure worktree path");
  }

  const isSummaryChecking =
    Boolean(workspaceRepoPath) &&
    (isLoadingRuntimeDefinitions ||
      isLoadingChecks ||
      runtimeCheck === null ||
      taskStoreCheck === null ||
      isRuntimeHealthPending ||
      hasRuntimeHealthChecking);

  const repositorySection: DiagnosticsSectionModel = {
    key: "repository",
    title: "Repository",
    badge: {
      label: worktreeAvailable ? "Configured" : "Needs setup",
      variant: worktreeAvailable ? "success" : "warning",
    },
    rows: activeWorkspace
      ? [
          { label: "Repository", value: repoName },
          {
            label: "Repository path",
            value: activeWorkspace.repoPath,
            breakAll: true,
            valueClassName: "text-muted-foreground",
          },
          {
            label: "Worktree directory",
            value: effectiveWorktreeBasePath ?? "Not available",
            breakAll: true,
            valueClassName: "text-muted-foreground",
          },
        ]
      : [],
    errors: [],
    ...(activeWorkspace ? {} : { emptyMessage: "Select a repository to load diagnostics." }),
  };

  const cliToolsHealthy = runtimeCheck === null ? null : !hasRuntimeCheckFailure(runtimeCheck);

  const cliToolsSection: DiagnosticsSectionModel = {
    key: "cli-tools",
    title: "CLI Tools",
    badge: getFailureBadge(cliToolsHealthy, runtimeCheckFailureKind, {
      healthy: "Available",
      timeout: "Timed out",
      error: "Issue",
      checking: "Checking",
    }),
    rows: runtimeCheck
      ? [
          { label: "Git", value: runtimeCheck.gitVersion ?? "missing" },
          { label: "GitHub CLI", value: runtimeCheck.ghVersion ?? "missing" },
        ]
      : [],
    errors:
      runtimeDefinitionsError != null
        ? [runtimeDefinitionsError, ...(runtimeCheck?.errors ?? [])]
        : buildFailureMessages({
            label: "CLI tools",
            detail: runtimeCheck?.errors[0] ?? null,
            failureKind: runtimeCheckFailureKind,
            availabilityVerb: "are",
          }),
    ...(runtimeCheck ? {} : { emptyMessage: "Runtime checks are loading..." }),
  };

  const runtimeSections = runtimeEntries.flatMap(({ definition, runtimeHealth }) => {
    const runtimeSection: DiagnosticsSectionModel = {
      key: `runtime:${definition.kind}`,
      title: `${definition.label} Runtime`,
      badge: getRepoRuntimeBadge(runtimeHealth ?? null),
      rows: buildRuntimeRows(runtimeHealth),
      errors: buildRuntimeSectionErrors(definition.label, runtimeHealth),
      ...(workspaceRepoPath
        ? runtimeHealth == null
          ? { emptyMessage: "Runtime health is loading..." }
          : {}
        : { emptyMessage: "Select a repository first." }),
    };

    if (!definition.capabilities.optionalSurfaces.supportsMcpStatus) {
      return [runtimeSection];
    }

    const mcpSection: DiagnosticsSectionModel = {
      key: `mcp:${definition.kind}`,
      title: `${definition.label} OpenDucktor MCP`,
      badge: getRepoRuntimeMcpBadge(runtimeHealth ?? null),
      rows: workspaceRepoPath ? buildMcpRows(runtimeHealth) : [],
      errors: buildMcpSectionErrors(definition.label, runtimeHealth),
      ...(workspaceRepoPath
        ? runtimeHealth == null
          ? { emptyMessage: "MCP health is loading..." }
          : {}
        : { emptyMessage: "Select a repository first." }),
    };

    return [runtimeSection, mcpSection];
  });

  const taskStoreSection: DiagnosticsSectionModel = {
    key: "task-store",
    title: "Task Store",
    badge: getRepoStoreFailureBadge(taskStoreCheck, taskStoreCheckFailureKind),
    rows: workspaceRepoPath ? buildRepoStoreRows(taskStoreCheck) : [],
    errors: buildRepoStoreErrors(taskStoreCheck, taskStoreCheckFailureKind),
    ...(workspaceRepoPath ? {} : { emptyMessage: "Select a repository first." }),
  };

  return {
    repoName,
    isSummaryChecking,
    summaryState: buildDiagnosticsSummary({
      hasActiveWorkspace: Boolean(workspaceRepoPath),
      isChecking: isSummaryChecking,
      hasCriticalIssues: criticalReasons.length > 0,
      hasSetupIssues: setupReasons.length > 0,
    }),
    criticalReasons,
    sections: [repositorySection, cliToolsSection, ...runtimeSections, taskStoreSection],
  };
};
