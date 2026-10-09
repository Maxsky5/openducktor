import type {
  GitCheck,
  PathCheck,
  RuntimeDescriptor,
  RuntimeKind,
  TaskStoreCheck,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { ObservedCheck } from "@/types/diagnostics";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import { buildHostModel, collectHostState } from "./diagnostics-host-model";
import { buildDiagnosticsSummary, type DiagnosticsSummary } from "./diagnostics-model";
import { collectWorkspaceState } from "./diagnostics-workspace-model";

export const buildDiagnosticsPanelModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsPanelModel => {
  const host = buildHostModel(input);
  const hostState = collectHostState(input, host);
  const workspace = collectWorkspaceState(input);
  const issues: DiagnosticsIssueModel[] = [
    ...hostState.reasons.map((message) => ({ scope: "host" as const, message })),
    ...workspace.reasons.map((message) => ({ scope: "workspace" as const, message })),
  ];
  const isChecking = hostState.isLoading || workspace.isLoading;

  return {
    overview: buildOverview({ host, workspace, issues, isChecking }),
    host,
    workspace: workspace.model,
    isSummaryChecking: isChecking,
    summaryState: buildDiagnosticsSummary({
      isChecking,
      hasCriticalIssues: issues.length > 0,
      hasSetupIssues: workspace.hasWarning,
    }),
    criticalReasons: issues.map((issue) => issue.message),
    hasHostBlockingFailure: hostState.reasons.length > 0,
    hasWorkspaceBlockingFailure: workspace.reasons.length > 0,
  };
};

const buildOverview = ({
  host,
  workspace,
  issues,
  isChecking,
}: {
  host: DiagnosticsHostModel;
  workspace: { model: DiagnosticsWorkspaceModel; hasWarning: boolean };
  issues: DiagnosticsIssueModel[];
  isChecking: boolean;
}): DiagnosticsOverviewModel => {
  if (issues.length > 0) {
    return {
      tone: "critical",
      title:
        issues.length === 1 ? "1 issue needs attention" : `${issues.length} issues need attention`,
      description: "Fix these issues so agent sessions can run.",
      issues,
    };
  }
  if (isChecking) {
    return {
      tone: "checking",
      title: "Running checks",
      description: "Each result shows when its check finishes.",
      issues: [],
    };
  }
  if (workspace.hasWarning) {
    return {
      tone: "warning",
      title: "Workspace setup needed",
      description: "Configure the worktree path in repository settings.",
      issues: [],
    };
  }
  const readyCount = host.runtimes.entries.filter((entry) => entry.status.health === "ok").length;
  let runtimeSummary = "No runtime is enabled.";
  if (readyCount === 1) {
    runtimeSummary = "1 runtime is ready.";
  } else if (readyCount > 1) {
    runtimeSummary = `${readyCount} runtimes are ready.`;
  }
  return {
    tone: "healthy",
    title: "Everything is working",
    description:
      workspace.model.kind === "selected"
        ? `${runtimeSummary} The workspace checks passed.`
        : runtimeSummary,
    issues: [],
  };
};

/** Health of one check, computed from check data. Rendering maps it to an icon and a badge. */
export type DiagnosticsHealth = "ok" | "loading" | "busy" | "warning" | "failed" | "neutral";

export type DiagnosticsStatus = {
  health: DiagnosticsHealth;
  label: string;
};

/** A secondary fact of a check, for example a path. */
export type DiagnosticsDetailModel = {
  label: string;
  value: string;
  /** Shows the value in a monospace font, truncated with its full text on hover. */
  isPath: boolean;
};

export type DiagnosticsCheckKey = "path" | "git" | "mcp-bridge" | "repository-setup" | "task-store";

/** One check in a group list. */
export type DiagnosticsCheckModel = {
  key: DiagnosticsCheckKey;
  title: string;
  status: DiagnosticsStatus;
  /** The main result, for example a version. Null when the status says enough. */
  value: string | null;
  details: DiagnosticsDetailModel[];
  /** Marks the result as an earlier result after a failed refresh. */
  notice: string | null;
  errors: string[];
};

/** The facts of a check before its status is known. */
export type DiagnosticsCheckBase = Omit<DiagnosticsCheckModel, "status" | "notice" | "errors">;

export type DiagnosticsRuntimeAction =
  | { type: "restart"; label: "Restart" | "Retry apply" }
  | { type: "open_settings" };

export type DiagnosticsRuntimeFailureModel = {
  message: string;
  nextAction: string;
};

export type DiagnosticsRuntimeEntryModel = {
  kind: RuntimeKind;
  label: string;
  status: DiagnosticsStatus;
  version: string | null;
  /** The configured executable. Null when the runtime uses the default executable. */
  executablePath: string | null;
  /** The executable in use, when it differs from the configured one. */
  effectiveExecutablePath: string | null;
  progress: string | null;
  failure: DiagnosticsRuntimeFailureModel | null;
  action: DiagnosticsRuntimeAction | null;
  isLifecycleBusy: boolean;
};

export type DiagnosticsRuntimesModel = {
  /** Explains why the shown states are loading, earlier, or unavailable. */
  notice: string | null;
  entries: DiagnosticsRuntimeEntryModel[];
};

export type DiagnosticsHostModel = {
  runtimes: DiagnosticsRuntimesModel;
  /** PATH, Git, and the OpenDucktor MCP bridge. */
  tools: DiagnosticsCheckModel[];
};

export type DiagnosticsWorkspaceModel =
  | { kind: "none"; emptyMessage: string }
  | {
      kind: "selected";
      name: string;
      path: string;
      /** Repository setup and task store. */
      checks: DiagnosticsCheckModel[];
    };

export type DiagnosticsIssueModel = {
  scope: "host" | "workspace";
  message: string;
};

export type DiagnosticsOverviewModel = {
  tone: "healthy" | "checking" | "warning" | "critical";
  title: string;
  description: string;
  issues: DiagnosticsIssueModel[];
};

export type DiagnosticsPanelModel = {
  overview: DiagnosticsOverviewModel;
  host: DiagnosticsHostModel;
  workspace: DiagnosticsWorkspaceModel;
  isSummaryChecking: boolean;
  summaryState: DiagnosticsSummary;
  criticalReasons: string[];
  hasHostBlockingFailure: boolean;
  hasWorkspaceBlockingFailure: boolean;
};

export type BuildDiagnosticsPanelModelInput = {
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeStatus: Pick<
    HostRuntimeStatusContextValue,
    "snapshot" | "statusByKind" | "isCurrent" | "isLoading" | "readError" | "streamError"
  >;
  pathCheck: ObservedCheck<PathCheck>;
  gitCheck: ObservedCheck<GitCheck>;
  workspace: WorkspaceRecord | null;
  /** The repository that the task store check below describes. */
  checksRepoPath: string | null;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
};
