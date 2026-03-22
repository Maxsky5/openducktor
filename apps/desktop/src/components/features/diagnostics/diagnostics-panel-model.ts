import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeRoute,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { runtimeLabelFor } from "@/lib/agent-runtime";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import {
  buildDiagnosticsSummary,
  type DiagnosticsSummary,
  healthVariant,
} from "./diagnostics-model";

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
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
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
    runtimeHealthByRuntime,
    isLoadingChecks,
  } = input;
  const repoName = activeRepo?.split("/").filter(Boolean).at(-1) ?? "No repository";
  const effectiveWorktreeBasePath = activeWorkspace?.effectiveWorktreeBasePath ?? null;
  const worktreeAvailable = Boolean(effectiveWorktreeBasePath);
  const hasRuntimeHealthData = runtimeDefinitions.some(
    (definition) => runtimeHealthByRuntime[definition.kind] !== undefined,
  );
  const runtimeEntries = runtimeDefinitions.map((definition) => ({
    definition,
    cliHealth: runtimeCheck?.runtimes.find((entry) => entry.kind === definition.kind) ?? null,
    runtimeHealth: runtimeHealthByRuntime[definition.kind] ?? null,
  }));

  const criticalReasons: string[] = [];
  if (activeRepo) {
    if (runtimeDefinitionsError) {
      criticalReasons.push(runtimeDefinitionsError);
    }
    if (runtimeCheck && (!runtimeCheck.gitOk || runtimeCheck.runtimes.some((entry) => !entry.ok))) {
      criticalReasons.push("Runtime CLI checks failing");
    }
    if (hasRuntimeHealthData) {
      for (const { definition, runtimeHealth } of runtimeEntries) {
        if (runtimeHealth?.runtimeOk === false) {
          criticalReasons.push(`${definition.label} runtime unavailable`);
        }
        if (definition.capabilities.supportsMcpStatus && runtimeHealth?.mcpOk === false) {
          criticalReasons.push(`${definition.label} OpenDucktor MCP unavailable`);
        }
      }
    }
    if (beadsCheck?.beadsOk === false) {
      criticalReasons.push("Beads store unavailable");
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
      beadsCheck === null);

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

  const cliToolsSection: DiagnosticsSectionModel = {
    key: "cli-tools",
    title: "CLI Tools",
    badge: {
      label:
        runtimeCheck === null
          ? "Checking"
          : runtimeCheck.gitOk && runtimeCheck.runtimes.every((entry) => entry.ok)
            ? "Available"
            : "Issue",
      variant: healthVariant(
        runtimeCheck === null
          ? null
          : runtimeCheck.gitOk && runtimeCheck.runtimes.every((entry) => entry.ok),
      ),
    },
    rows: runtimeCheck
      ? [
          { label: "Git", value: runtimeCheck.gitVersion ?? "missing" },
          { label: "GitHub CLI", value: runtimeCheck.ghVersion ?? "missing" },
          ...cliRuntimeRows,
        ]
      : [],
    errors: runtimeDefinitionsError
      ? [runtimeDefinitionsError, ...(runtimeCheck?.errors ?? [])]
      : (runtimeCheck?.errors ?? []),
    ...(runtimeCheck ? {} : { emptyMessage: "Runtime checks are loading..." }),
  };

  const runtimeSections = runtimeEntries.flatMap(({ definition, runtimeHealth }) => {
    const runtimeSection: DiagnosticsSectionModel = {
      key: `runtime:${definition.kind}`,
      title: `${definition.label} Runtime`,
      badge: {
        label:
          runtimeHealth === null ? "Checking" : runtimeHealth.runtimeOk ? "Running" : "Unavailable",
        variant: healthVariant(runtimeHealth?.runtimeOk ?? null),
      },
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
          ]
        : [],
      errors: runtimeHealth?.runtimeError ? [runtimeHealth.runtimeError] : [],
      ...(activeRepo
        ? runtimeHealth === null
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
      badge: {
        label:
          runtimeHealth === null ? "Checking" : runtimeHealth.mcpOk ? "Connected" : "Unavailable",
        variant: healthVariant(runtimeHealth?.mcpOk ?? null),
      },
      rows: activeRepo
        ? [
            {
              label: "Server name",
              value: runtimeHealth?.mcpServerName ?? "openducktor",
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
          ]
        : [],
      errors:
        runtimeHealth?.mcpServerError || runtimeHealth?.mcpError
          ? [runtimeHealth.mcpServerError ?? runtimeHealth.mcpError ?? ""]
          : [],
      ...(activeRepo
        ? runtimeHealth === null
          ? { emptyMessage: "MCP health is loading..." }
          : {}
        : { emptyMessage: "Select a repository first." }),
    };

    return [runtimeSection, mcpSection];
  });

  const beadsStoreSection: DiagnosticsSectionModel = {
    key: "beads-store",
    title: "Beads Store",
    badge: {
      label: beadsCheck === null ? "Checking" : beadsCheck.beadsOk ? "Ready" : "Unavailable",
      variant: healthVariant(beadsCheck?.beadsOk ?? null),
    },
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
    errors: beadsCheck?.beadsError ? [beadsCheck.beadsError] : [],
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
