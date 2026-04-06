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
  describeRepoRuntimeStatus,
  formatRepoRuntimeElapsed,
  formatRepoRuntimeObservation,
  getRepoRuntimeBadge,
  getRepoRuntimeMcpActivity,
  getRepoRuntimeMcpBadge,
  getRepoRuntimeMcpStatusLabel,
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
        label: "Endpoint",
        value: resolveRuntimeEndpoint(instance.runtimeRoute),
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
      if (runtimeHealth?.status === "error") {
        criticalReasons.push(
          describeRepoRuntimeStatus(definition.label, runtimeHealth) ??
            `${definition.label} runtime health has an issue.`,
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
      isRuntimeHealthPending ||
      hasCheckingRuntimeHealth);

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
