import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { runtimeLabelFor } from "@/lib/agent-runtime";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import {
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
  getRepoStoreOwnershipLabel,
  getRepoStoreStatusLabel,
  isRepoStoreReady,
} from "@/lib/repo-store-health";
import { describeRuntimeRoute } from "@/state/operations/agent-orchestrator/runtime/runtime";
import {
  buildTimeoutToastDescription,
  hasBeadsCheckFailure,
  hasDiagnosticsRetryingState,
  hasRuntimeCheckFailure,
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
  activeRepo: string | null;
  activeWorkspace: WorkspaceRecord | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
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
    return [
      buildTimeoutToastDescription(
        label,
        detail,
        availabilityVerb ? { availabilityVerb } : undefined,
      ),
    ];
  }

  return detail ? [detail] : [];
};

const getRepoStoreFailureBadge = (
  beadsCheck: BeadsCheck | null,
  failureKind: RepoRuntimeFailureKind,
): DiagnosticsSectionModel["badge"] => {
  if (failureKind === "timeout") {
    return { label: "Retrying", variant: "warning" };
  }
  const repoStoreHealth = getRepoStoreHealth(beadsCheck);
  if (repoStoreHealth === null) {
    return { label: "Checking", variant: "secondary" };
  }

  switch (repoStoreHealth.status) {
    case "initializing":
      return { label: "Preparing", variant: "secondary" };
    case "ready":
      return { label: "Ready", variant: "success" };
    case "degraded":
      return { label: "Degraded", variant: "warning" };
    case "restore_needed":
      return { label: "Restore needed", variant: "warning" };
    case "blocking":
      return { label: "Blocked", variant: "danger" };
  }
};

const buildRepoStoreRows = (beadsCheck: BeadsCheck | null): DiagnosticKeyValueRowModel[] => {
  const repoStoreHealth = getRepoStoreHealth(beadsCheck);
  if (!repoStoreHealth) {
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
      label: "Beads attachment path",
      value: repoStoreHealth.attachment.path ?? "Unavailable",
      breakAll: true,
      valueClassName: "text-muted-foreground",
    },
    {
      label: "Dolt database name",
      value: repoStoreHealth.attachment.databaseName ?? "Unavailable",
      mono: true,
      valueClassName: "text-muted-foreground",
    },
    {
      label: "Dolt server host",
      value: repoStoreHealth.sharedServer.host ?? "Unavailable",
      mono: true,
      valueClassName: "text-muted-foreground",
    },
    {
      label: "Dolt server port",
      value:
        repoStoreHealth.sharedServer.port === null
          ? "Unavailable"
          : String(repoStoreHealth.sharedServer.port),
      mono: true,
      valueClassName: "text-muted-foreground",
    },
    {
      label: "Dolt server ownership",
      value: getRepoStoreOwnershipLabel(repoStoreHealth),
      valueClassName: "text-muted-foreground",
    },
  ];

  return rows;
};

const buildRepoStoreErrors = (
  beadsCheck: BeadsCheck | null,
  failureKind: RepoRuntimeFailureKind,
): string[] => {
  if (failureKind === "timeout") {
    const repoStoreHealth = getRepoStoreHealth(beadsCheck);
    return buildFailureMessages({
      label: "Beads store",
      detail: repoStoreHealth ? getRepoStoreDetail(repoStoreHealth) : null,
      failureKind,
    });
  }

  const repoStoreHealth = getRepoStoreHealth(beadsCheck);
  if (
    !repoStoreHealth ||
    isRepoStoreReady(repoStoreHealth) ||
    repoStoreHealth.status === "initializing"
  ) {
    return [];
  }

  return buildFailureMessages({
    label: "Beads store",
    detail: getRepoStoreDetail(repoStoreHealth),
    failureKind,
  });
};

const buildRuntimeRows = (runtimeHealth: RuntimeHealthState): DiagnosticKeyValueRowModel[] => {
  if (!runtimeHealth) {
    return [];
  }

  const rows: DiagnosticKeyValueRowModel[] = [];
  const instance = runtimeHealth.runtime.instance;
  if (instance) {
    rows.push(
      {
        label: "Runtime ID",
        value: instance.runtimeId,
        mono: true,
        valueClassName: "text-muted-foreground",
      },
      {
        label: "Route",
        value: describeRuntimeRoute(instance.runtimeRoute),
        mono: true,
        valueClassName: "text-muted-foreground",
      },
      {
        label: "Working directory",
        value: instance.workingDirectory,
        breakAll: true,
        valueClassName: "text-muted-foreground",
      },
    );
  }

  if (runtimeHealth.runtime.status !== "ready") {
    rows.push({
      label: "Stage",
      value: runtimeHealth.runtime.stage.replaceAll("_", " "),
      valueClassName: "text-muted-foreground",
    });

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
  if (!runtimeHealth || runtimeHealth.runtime.status !== "error") {
    return [];
  }

  return buildFailureMessages({
    label: `${runtimeLabel} runtime`,
    detail: runtimeHealth.runtime.detail ?? `${runtimeLabel} runtime is unavailable.`,
    failureKind: runtimeHealth.runtime.failureKind ?? "error",
  });
};

const buildMcpSectionErrors = (
  runtimeLabel: string,
  runtimeHealth: RuntimeHealthState,
): string[] => {
  if (!runtimeHealth?.mcp || runtimeHealth.mcp.status !== "error") {
    return [];
  }

  if (runtimeHealth.runtime.status !== "ready") {
    return [];
  }

  return buildFailureMessages({
    label: `${runtimeLabel} OpenDucktor MCP`,
    detail: runtimeHealth.mcp.detail ?? `${runtimeLabel} OpenDucktor MCP is unavailable.`,
    failureKind: runtimeHealth.mcp.failureKind ?? "error",
  });
};

export const buildDiagnosticsPanelModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsPanelModel => {
  const {
    activeRepo,
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeCheck,
    beadsCheck,
    runtimeCheckFailureKind,
    beadsCheckFailureKind,
    runtimeHealthByRuntime,
    isLoadingChecks,
  } = input;
  const repoName = activeRepo?.split("/").filter(Boolean).at(-1) ?? "No repository";
  const effectiveWorktreeBasePath = activeWorkspace?.effectiveWorktreeBasePath ?? null;
  const worktreeAvailable = Boolean(effectiveWorktreeBasePath);
  const runtimeEntries = runtimeDefinitions.map((definition) => ({
    definition,
    cliHealth: runtimeCheck?.runtimes.find((entry) => entry.kind === definition.kind) ?? null,
    runtimeHealth: runtimeHealthByRuntime[definition.kind],
  }));
  const isRuntimeHealthPending = runtimeDefinitions.some(
    (definition) => runtimeHealthByRuntime[definition.kind] === undefined,
  );
  const hasCheckingRuntimeHealth = runtimeEntries.some(
    ({ runtimeHealth }) => runtimeHealth?.status === "checking",
  );

  const criticalReasons: string[] = [];
  if (activeRepo) {
    const repoStoreHealth = getRepoStoreHealth(beadsCheck);
    if (runtimeDefinitionsError) {
      criticalReasons.push(runtimeDefinitionsError);
    }
    if (hasRuntimeCheckFailure(runtimeCheck) && runtimeCheckFailureKind !== "timeout") {
      criticalReasons.push("Runtime CLI checks failing");
    }
    for (const { definition, runtimeHealth } of runtimeEntries) {
      if (runtimeHealth?.status === "error") {
        criticalReasons.push(
          describeRepoRuntimeStatus(definition.label, runtimeHealth) ??
            `${definition.label} runtime health has an issue.`,
        );
      }
    }
    if (
      repoStoreHealth &&
      hasBeadsCheckFailure(beadsCheck) &&
      beadsCheckFailureKind !== "timeout"
    ) {
      criticalReasons.push(getRepoStoreDetail(repoStoreHealth));
    }
  }

  const setupReasons: string[] = [];
  if (activeRepo && !worktreeAvailable) {
    setupReasons.push("Configure worktree path");
  }

  const isSummaryChecking =
    Boolean(activeRepo) &&
    (isLoadingRuntimeDefinitions ||
      isLoadingChecks ||
      runtimeCheck === null ||
      beadsCheck === null ||
      beadsCheck?.repoStoreHealth.status === "initializing" ||
      isRuntimeHealthPending ||
      hasCheckingRuntimeHealth ||
      hasDiagnosticsRetryingState({
        runtimeDefinitions,
        runtimeCheckFailureKind,
        beadsCheckFailureKind,
        runtimeHealthByRuntime,
      }));

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

  const cliRuntimeRows =
    runtimeDefinitions.length > 0
      ? runtimeEntries.map(({ definition, cliHealth }) => ({
          label: runtimeLabelFor({ runtimeDefinitions, runtimeKind: definition.kind }),
          value: cliHealth?.ok ? (cliHealth.version ?? "detected") : "missing",
        }))
      : (runtimeCheck?.runtimes ?? []).map((runtimeEntry) => ({
          label: runtimeEntry.kind,
          value: runtimeEntry.ok ? (runtimeEntry.version ?? "detected") : "missing",
        }));
  const cliToolsHealthy = runtimeCheck === null ? null : !hasRuntimeCheckFailure(runtimeCheck);

  const cliToolsSection: DiagnosticsSectionModel = {
    key: "cli-tools",
    title: "CLI Tools",
    badge: getFailureBadge(cliToolsHealthy, runtimeCheckFailureKind, {
      healthy: "Available",
      timeout: "Retrying",
      error: "Issue",
      checking: "Checking",
    }),
    rows: runtimeCheck
      ? [
          { label: "Git", value: runtimeCheck.gitVersion ?? "missing" },
          { label: "GitHub CLI", value: runtimeCheck.ghVersion ?? "missing" },
          ...cliRuntimeRows,
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
      ...(activeRepo
        ? runtimeHealth == null
          ? { emptyMessage: "Runtime health is loading..." }
          : {}
        : { emptyMessage: "Select a repository first." }),
    };

    if (!definition.capabilities.supportsMcpStatus) {
      return [runtimeSection];
    }

    const mcpSection: DiagnosticsSectionModel = {
      key: `mcp:${definition.kind}`,
      title: `${definition.label} OpenDucktor MCP`,
      badge: getRepoRuntimeMcpBadge(runtimeHealth ?? null),
      rows: activeRepo ? buildMcpRows(runtimeHealth) : [],
      errors: buildMcpSectionErrors(definition.label, runtimeHealth),
      ...(activeRepo
        ? runtimeHealth == null
          ? { emptyMessage: "MCP health is loading..." }
          : {}
        : { emptyMessage: "Select a repository first." }),
    };

    return [runtimeSection, mcpSection];
  });

  const beadsStoreSection: DiagnosticsSectionModel = {
    key: "beads-store",
    title: "Beads Store",
    badge: getRepoStoreFailureBadge(beadsCheck, beadsCheckFailureKind),
    rows: activeRepo ? buildRepoStoreRows(beadsCheck) : [],
    errors: buildRepoStoreErrors(beadsCheck, beadsCheckFailureKind),
    ...(activeRepo ? {} : { emptyMessage: "Select a repository first." }),
  };

  return {
    repoName,
    isSummaryChecking,
    summaryState: buildDiagnosticsSummary({
      hasActiveRepo: Boolean(activeRepo),
      isChecking: isSummaryChecking,
      hasCriticalIssues: criticalReasons.length > 0,
      hasSetupIssues: setupReasons.length > 0,
    }),
    criticalReasons,
    sections: [repositorySection, cliToolsSection, ...runtimeSections, beadsStoreSection],
  };
};
