import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeRoute,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { runtimeLabelFor } from "@/lib/agent-runtime";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import {
  describeRepoRuntimeProgress,
  formatRepoRuntimeElapsed,
  formatRepoRuntimeObservation,
} from "@/lib/repo-runtime-health";
import {
  buildTimeoutToastDescription,
  hasBeadsCheckFailure,
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

const getFailureBadge = (
  ok: boolean | null,
  failureKind: RepoRuntimeFailureKind,
  labels: { healthy: string; timeout: string; error: string; checking: string },
): DiagnosticsSectionModel["badge"] => {
  if (ok === null) {
    return {
      label: labels.checking,
      variant: "secondary",
    };
  }

  if (ok) {
    return {
      label: labels.healthy,
      variant: "success",
    };
  }

  if (failureKind === "timeout") {
    return {
      label: labels.timeout,
      variant: "warning",
    };
  }

  return {
    label: labels.error,
    variant: "danger",
  };
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

const buildProgressRows = (
  runtimeHealth: RepoRuntimeHealthMap[string] | undefined,
): DiagnosticKeyValueRowModel[] => {
  const progress = runtimeHealth?.progress;
  if (!progress) {
    return [];
  }

  const rows: DiagnosticKeyValueRowModel[] = [
    {
      label: "Stage",
      value: progress.stage.replaceAll("_", " "),
      valueClassName: "text-muted-foreground",
    },
  ];
  const observation = formatRepoRuntimeObservation(progress.observation);
  if (observation) {
    rows.push({
      label: "Observation",
      value: observation,
      valueClassName: "text-muted-foreground",
    });
  }
  const elapsed = formatRepoRuntimeElapsed(progress.elapsedMs);
  if (elapsed) {
    rows.push({
      label: "Elapsed",
      value: elapsed,
      mono: true,
      valueClassName: "text-muted-foreground",
    });
  }
  if (progress.attempts !== null) {
    rows.push({
      label: "Attempts",
      value: String(progress.attempts),
      mono: true,
      valueClassName: "text-muted-foreground",
    });
  }
  return rows;
};

const getRuntimeBadge = (
  runtimeHealth: RepoRuntimeHealthMap[string] | undefined,
): DiagnosticsSectionModel["badge"] | null => {
  switch (runtimeHealth?.progress?.stage) {
    case "startup_requested":
    case "waiting_for_runtime":
      return { label: "Starting", variant: "warning" };
    case "restarting_runtime":
      return { label: "Restarting", variant: "warning" };
    default:
      return null;
  }
};

const getMcpBadge = (
  runtimeHealth: RepoRuntimeHealthMap[string] | undefined,
): DiagnosticsSectionModel["badge"] | null => {
  switch (runtimeHealth?.progress?.stage) {
    case "checking_mcp_status":
      return { label: "Checking", variant: "secondary" };
    case "reconnecting_mcp":
      return { label: "Reconnecting", variant: "warning" };
    case "restarting_runtime":
      return { label: "Waiting on runtime", variant: "warning" };
    default:
      return null;
  }
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

  const criticalReasons: string[] = [];
  if (activeRepo) {
    if (runtimeDefinitionsError) {
      criticalReasons.push(runtimeDefinitionsError);
    }
    if (hasRuntimeCheckFailure(runtimeCheck)) {
      criticalReasons.push(
        runtimeCheckFailureKind === "timeout"
          ? "Runtime CLI checks still retrying"
          : "Runtime CLI checks failing",
      );
    }
    for (const { definition, runtimeHealth } of runtimeEntries) {
      if (runtimeHealth?.runtimeOk === false) {
        criticalReasons.push(
          describeRepoRuntimeProgress(definition.label, runtimeHealth ?? null) ??
            (runtimeHealth.runtimeFailureKind === "timeout"
              ? `${definition.label} runtime is still starting`
              : `${definition.label} runtime unavailable`),
        );
      }
      if (definition.capabilities.supportsMcpStatus && runtimeHealth?.mcpOk === false) {
        criticalReasons.push(
          describeRepoRuntimeProgress(definition.label, runtimeHealth ?? null) ??
            (runtimeHealth.mcpFailureKind === "timeout"
              ? `${definition.label} OpenDucktor MCP is still starting`
              : `${definition.label} OpenDucktor MCP unavailable`),
        );
      }
    }
    if (hasBeadsCheckFailure(beadsCheck)) {
      criticalReasons.push(
        beadsCheckFailureKind === "timeout"
          ? "Beads store still retrying"
          : "Beads store unavailable",
      );
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
      isRuntimeHealthPending);

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
            value: activeWorkspace.path,
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
    const progressDescription = describeRepoRuntimeProgress(
      definition.label,
      runtimeHealth ?? null,
    );
    const runtimeSection: DiagnosticsSectionModel = {
      key: `runtime:${definition.kind}`,
      title: `${definition.label} Runtime`,
      badge:
        getRuntimeBadge(runtimeHealth) ??
        getFailureBadge(
          runtimeHealth?.runtimeOk ?? null,
          runtimeHealth?.runtimeFailureKind ?? null,
          {
            healthy: "Running",
            timeout: "Starting",
            error: "Unavailable",
            checking: "Checking",
          },
        ),
      rows: runtimeHealth?.runtime
        ? [
            {
              label: "Runtime ID",
              value: runtimeHealth.runtime.runtimeId,
              mono: true,
              valueClassName: "text-muted-foreground",
            },
            {
              label: "Endpoint",
              value: resolveRuntimeEndpoint(runtimeHealth.runtime.runtimeRoute),
              mono: true,
              valueClassName: "text-muted-foreground",
            },
            {
              label: "Working directory",
              value: runtimeHealth.runtime.workingDirectory,
              breakAll: true,
              valueClassName: "text-muted-foreground",
            },
            ...buildProgressRows(runtimeHealth),
          ]
        : buildProgressRows(runtimeHealth),
      errors:
        runtimeHealth?.runtimeOk === false && progressDescription != null
          ? [progressDescription]
          : buildFailureMessages({
              label: `${definition.label} runtime`,
              detail: runtimeHealth?.runtimeError ?? null,
              failureKind: runtimeHealth?.runtimeFailureKind ?? null,
            }),
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
      title: `${definition.label} MCP`,
      badge:
        getMcpBadge(runtimeHealth) ??
        getFailureBadge(runtimeHealth?.mcpOk ?? null, runtimeHealth?.mcpFailureKind ?? null, {
          healthy: "Connected",
          timeout: "Retrying",
          error: "Unavailable",
          checking: "Checking",
        }),
      rows: activeRepo
        ? [
            {
              label: "Server name",
              value: runtimeHealth?.mcpServerName ?? ODT_MCP_SERVER_NAME,
              mono: true,
            },
            {
              label: "Status",
              value: runtimeHealth?.mcpServerStatus ?? "unavailable",
              valueClassName: runtimeHealth?.mcpServerStatus
                ? "font-medium"
                : "text-muted-foreground",
            },
            {
              label: "Tools detected",
              value: String(runtimeHealth?.availableToolIds.length ?? 0),
              mono: true,
              valueClassName: "text-muted-foreground",
            },
            ...buildProgressRows(runtimeHealth),
          ]
        : [],
      errors:
        progressDescription != null && !runtimeHealth?.mcpOk
          ? [progressDescription]
          : buildFailureMessages({
              label: `${definition.label} OpenDucktor MCP`,
              detail: runtimeHealth?.mcpServerError ?? runtimeHealth?.mcpError ?? null,
              failureKind: runtimeHealth?.mcpFailureKind ?? null,
            }),
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
    badge: getFailureBadge(beadsCheck?.beadsOk ?? null, beadsCheckFailureKind, {
      healthy: "Ready",
      timeout: "Retrying",
      error: "Unavailable",
      checking: "Checking",
    }),
    rows:
      activeRepo && beadsCheck?.beadsPath
        ? [
            {
              label: "Store path",
              value: beadsCheck.beadsPath,
              breakAll: true,
              valueClassName: "text-muted-foreground",
            },
          ]
        : [],
    errors: buildFailureMessages({
      label: "Beads store",
      detail: beadsCheck?.beadsError ?? null,
      failureKind: beadsCheckFailureKind,
    }),
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

const resolveRuntimeEndpoint = (runtimeRoute: RuntimeRoute | undefined): string => {
  if (!runtimeRoute) {
    return "unavailable";
  }
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
};
