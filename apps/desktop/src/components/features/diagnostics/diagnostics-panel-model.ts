import type { BeadsCheck, RuntimeCheck, WorkspaceRecord } from "@openducktor/contracts";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
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

type DiagnosticsSectionModel = {
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
  sections: {
    repository: DiagnosticsSectionModel;
    cliTools: DiagnosticsSectionModel;
    opencodeRuntime: DiagnosticsSectionModel;
    openducktorMcp: DiagnosticsSectionModel;
    beadsStore: DiagnosticsSectionModel;
  };
};

type BuildDiagnosticsPanelModelInput = {
  activeRepo: string | null;
  activeWorkspace: WorkspaceRecord | null;
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  opencodeHealth: RepoOpencodeHealthCheck | null;
  isLoadingChecks: boolean;
};

export const buildDiagnosticsPanelModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsPanelModel => {
  const { activeRepo, activeWorkspace, runtimeCheck, beadsCheck, opencodeHealth, isLoadingChecks } =
    input;

  const runtimeHealthy = runtimeCheck ? runtimeCheck.gitOk && runtimeCheck.opencodeOk : null;
  const beadsHealthy = beadsCheck ? beadsCheck.beadsOk : null;
  const opencodeServerHealthy = opencodeHealth ? opencodeHealth.runtimeOk : null;
  const openducktorMcpHealthy = opencodeHealth ? opencodeHealth.mcpOk : null;
  const runtimeCritical = runtimeHealthy === false;
  const beadsCritical = beadsHealthy === false;
  const opencodeServerCritical = opencodeServerHealthy === false;
  const openducktorMcpCritical = openducktorMcpHealthy === false;
  const worktreeConfigured = activeWorkspace?.hasConfig ?? false;
  const repoName = activeRepo?.split("/").filter(Boolean).at(-1) ?? "No repository";

  const criticalReasons: string[] = [];
  if (activeRepo) {
    if (runtimeCritical) {
      criticalReasons.push("Runtime checks failing");
    }
    if (opencodeServerCritical) {
      criticalReasons.push("OpenCode server unavailable");
    }
    if (openducktorMcpCritical) {
      criticalReasons.push("OpenDucktor MCP unavailable");
    }
    if (beadsCritical) {
      criticalReasons.push("Beads store unavailable");
    }
  }

  const setupReasons: string[] = [];
  if (activeRepo && !worktreeConfigured) {
    setupReasons.push("Configure worktree path");
  }

  const isSummaryChecking =
    Boolean(activeRepo) &&
    (isLoadingChecks || runtimeCheck === null || beadsCheck === null || opencodeHealth === null);

  const summaryState = buildDiagnosticsSummary({
    hasActiveRepo: Boolean(activeRepo),
    isChecking: isSummaryChecking,
    hasCriticalIssues: criticalReasons.length > 0,
    hasSetupIssues: setupReasons.length > 0,
  });

  const repositorySection: DiagnosticsSectionModel = {
    title: "Repository",
    badge: {
      label: worktreeConfigured ? "Configured" : "Needs setup",
      variant: worktreeConfigured ? "success" : "warning",
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
            value: activeWorkspace.configuredWorktreeBasePath ?? "Not configured",
            breakAll: true,
            valueClassName: activeWorkspace.configuredWorktreeBasePath
              ? "text-muted-foreground"
              : "text-muted-foreground",
          },
        ]
      : [],
    errors: [],
    ...(activeWorkspace ? {} : { emptyMessage: "Select a repository to load diagnostics." }),
  };

  const cliToolsSection: DiagnosticsSectionModel = {
    title: "CLI Tools",
    badge: {
      label: runtimeHealthy === null ? "Checking" : runtimeHealthy ? "Available" : "Issue",
      variant: healthVariant(runtimeHealthy),
    },
    rows: runtimeCheck
      ? [
          { label: "Git", value: runtimeCheck.gitVersion ?? "missing" },
          {
            label: "OpenCode",
            value: runtimeCheck.opencodeOk
              ? (runtimeCheck.opencodeVersion ?? "detected")
              : "missing",
          },
        ]
      : [],
    errors: runtimeCheck ? runtimeCheck.errors : [],
    ...(runtimeCheck ? {} : { emptyMessage: "Runtime checks are loading..." }),
  };

  const opencodeRuntimeSection: DiagnosticsSectionModel = {
    title: "OpenCode Runtime",
    badge: {
      label:
        opencodeServerHealthy === null
          ? "Checking"
          : opencodeServerHealthy
            ? "Running"
            : "Unavailable",
      variant: healthVariant(opencodeServerHealthy),
    },
    rows: opencodeHealth?.runtime
      ? [
          {
            label: "Runtime ID",
            value: opencodeHealth.runtime.runtimeId,
            mono: true,
            valueClassName: "text-muted-foreground",
          },
          {
            label: "Endpoint",
            value: `http://127.0.0.1:${opencodeHealth.runtime.port}`,
            mono: true,
            valueClassName: "text-muted-foreground",
          },
          {
            label: "Working directory",
            value: opencodeHealth.runtime.workingDirectory,
            breakAll: true,
            valueClassName: "text-muted-foreground",
          },
        ]
      : [],
    errors: opencodeHealth?.runtimeError ? [opencodeHealth.runtimeError] : [],
    ...(activeRepo ? {} : { emptyMessage: "Select a repository first." }),
  };

  const openducktorMcpSection: DiagnosticsSectionModel = {
    title: "OpenDucktor MCP",
    badge: {
      label:
        openducktorMcpHealthy === null
          ? "Checking"
          : openducktorMcpHealthy
            ? "Connected"
            : "Unavailable",
      variant: healthVariant(openducktorMcpHealthy),
    },
    rows: activeRepo
      ? [
          {
            label: "Server name",
            value: opencodeHealth?.mcpServerName ?? "openducktor",
            mono: true,
          },
          {
            label: "Status",
            value: opencodeHealth?.mcpServerStatus ?? "unavailable",
            valueClassName: opencodeHealth?.mcpServerStatus ? "font-medium" : "text-muted-foreground",
          },
          {
            label: "Tools detected",
            value: String(opencodeHealth?.availableToolIds.length ?? 0),
            mono: true,
            valueClassName: "text-muted-foreground",
          },
        ]
      : [],
    errors:
      opencodeHealth?.mcpServerError || opencodeHealth?.mcpError
        ? [opencodeHealth.mcpServerError ?? opencodeHealth.mcpError ?? ""]
        : [],
    ...(activeRepo ? {} : { emptyMessage: "Select a repository first." }),
  };

  const beadsStoreSection: DiagnosticsSectionModel = {
    title: "Beads Store",
    badge: {
      label: beadsHealthy === null ? "Checking" : beadsHealthy ? "Ready" : "Unavailable",
      variant: healthVariant(beadsHealthy),
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
    summaryState,
    criticalReasons,
    sections: {
      repository: repositorySection,
      cliTools: cliToolsSection,
      opencodeRuntime: opencodeRuntimeSection,
      openducktorMcp: openducktorMcpSection,
      beadsStore: beadsStoreSection,
    },
  };
};
