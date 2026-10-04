import type {
  RepoStoreHealth,
  TaskStoreCheck,
  WorkspaceRecord,
  WorkspaceRuntimeMcpCheck,
  WorkspaceRuntimeMcpStatus,
} from "@openducktor/contracts";
import {
  getRepoStoreCategoryLabel,
  getRepoStoreDetail,
  getRepoStoreHealth,
  getRepoStoreStatusLabel,
  isRepoStoreReady,
} from "@/lib/repo-store-health";
import { hasTaskStoreCheckFailure } from "@/state/operations/workspace/check-diagnostics";
import type { ObservedCheck } from "@/types/diagnostics";
import {
  buildRefreshFailedSection,
  earlierResultNotice,
  LOADING_STATUS,
  MUTED_VALUE,
  refreshFailureMessage,
  refreshFailureStatus,
  runtimeLabel,
} from "./diagnostics-check-section";
import type {
  BuildDiagnosticsPanelModelInput,
  DiagnosticKeyValueRowModel,
  DiagnosticsMcpObservationModel,
  DiagnosticsRuntimeMcpEntryModel,
  DiagnosticsRuntimeMcpModel,
  DiagnosticsSectionModel,
  DiagnosticsStatus,
  DiagnosticsWorkspaceModel,
} from "./diagnostics-panel-model";

export const NO_WORKSPACE_MESSAGE = "Select a workspace to view workspace checks.";

const TASK_STORE_TITLE = "Task store";
export const RUNTIME_MCP_TITLE = "Runtime OpenDucktor MCP connections";

export type WorkspaceDiagnosticsState = {
  model: DiagnosticsWorkspaceModel;
  reasons: string[];
  isLoading: boolean;
  hasWarning: boolean;
};

export const collectWorkspaceState = (
  input: BuildDiagnosticsPanelModelInput,
): WorkspaceDiagnosticsState => {
  const { workspace } = input;
  if (workspace === null) {
    return {
      model: { kind: "none", emptyMessage: NO_WORKSPACE_MESSAGE },
      reasons: [],
      isLoading: false,
      hasWarning: false,
    };
  }
  // Never show results of another workspace under this workspace label.
  const checksMatch = input.checksRepoPath === workspace.repoPath;
  const taskStoreRead: ObservedCheck<TaskStoreCheck> = checksMatch
    ? input.taskStoreCheck
    : { data: null, error: null, failureKind: null, observedAt: null };
  const mcpRead = input.workspaceRuntimeMcpCheck;
  const mcpCheck =
    checksMatch && mcpRead.data?.repoPath === workspace.repoPath ? mcpRead.data : null;
  const runtimeMcp = buildRuntimeMcpModel(input, mcpCheck, checksMatch ? mcpRead.error : null);
  const taskStore = buildTaskStoreSection(taskStoreRead);
  const repositorySetup = buildRepositorySetupSection(workspace);

  const reasons: string[] = [];
  // A failed refresh takes priority over a retained earlier result.
  const repoStoreHealth = getRepoStoreHealth(taskStoreRead.data);
  if (taskStoreRead.error !== null) {
    reasons.push(refreshFailureMessage(TASK_STORE_TITLE, taskStoreRead.error));
  } else if (repoStoreHealth !== null && hasTaskStoreCheckFailure(taskStoreRead.data)) {
    reasons.push(getRepoStoreDetail(repoStoreHealth));
  }
  reasons.push(...runtimeMcp.errors);
  return {
    model: {
      kind: "selected",
      name: workspace.workspaceName,
      path: workspace.repoPath,
      repositorySetup,
      taskStore,
      runtimeMcp,
    },
    reasons,
    isLoading: taskStore.status.health === "loading" || runtimeMcp.status.health === "loading",
    hasWarning: workspace.effectiveWorktreeBasePath === null,
  };
};

const buildRepositorySetupSection = (workspace: WorkspaceRecord): DiagnosticsSectionModel => {
  const worktreePath = workspace.effectiveWorktreeBasePath;
  return {
    key: "repository-setup",
    title: "Repository setup",
    status:
      worktreePath !== null
        ? { health: "ok", label: "Configured" }
        : { health: "warning", label: "Needs setup" },
    rows: [
      {
        label: "Repository path",
        value: workspace.repoPath,
        breakAll: true,
        valueClassName: MUTED_VALUE,
      },
      {
        label: "Worktree directory",
        value: worktreePath ?? "Not available",
        breakAll: true,
        valueClassName: MUTED_VALUE,
      },
    ],
    errors: worktreePath === null ? ["Configure the worktree path in repository settings."] : [],
  };
};

const buildTaskStoreSection = (read: ObservedCheck<TaskStoreCheck>): DiagnosticsSectionModel => {
  const base = { key: "task-store", title: TASK_STORE_TITLE };
  const repoStoreHealth = getRepoStoreHealth(read.data);
  if (read.error !== null) {
    return buildRefreshFailedSection(
      base,
      { error: read.error, failureKind: read.failureKind },
      repoStoreHealth !== null && read.observedAt !== null
        ? { observedAt: read.observedAt, rows: buildTaskStoreRows(repoStoreHealth) }
        : null,
    );
  }
  if (repoStoreHealth === null) {
    return {
      ...base,
      status: LOADING_STATUS,
      rows: [],
      errors: [],
      emptyMessage: "Task store check is loading.",
    };
  }
  return {
    ...base,
    status: getTaskStoreStatus(repoStoreHealth),
    rows: buildTaskStoreRows(repoStoreHealth),
    errors: isRepoStoreReady(repoStoreHealth) ? [] : [getRepoStoreDetail(repoStoreHealth)],
  };
};

const getTaskStoreStatus = (repoStoreHealth: RepoStoreHealth): DiagnosticsStatus => {
  switch (repoStoreHealth.status) {
    case "ready":
      return { health: "ok", label: "Ready" };
    case "degraded":
      return { health: "warning", label: "Degraded" };
    case "blocking":
      return { health: "failed", label: "Blocked" };
  }
};

const buildTaskStoreRows = (repoStoreHealth: RepoStoreHealth): DiagnosticKeyValueRowModel[] => [
  { label: "Status", value: getRepoStoreStatusLabel(repoStoreHealth) },
  { label: "Health category", value: getRepoStoreCategoryLabel(repoStoreHealth) },
  {
    label: "SQLite database path",
    value: repoStoreHealth.databasePath ?? "Unavailable",
    breakAll: true,
    mono: repoStoreHealth.databasePath !== null,
    valueClassName: MUTED_VALUE,
  },
];

const MCP_STATE_STATUSES = {
  not_checked: { health: "neutral", label: "Not checked" },
  unavailable: { health: "neutral", label: "Unavailable" },
  unsupported: { health: "neutral", label: "Unsupported" },
  observed: { health: "ok", label: "Connected" },
} satisfies Record<WorkspaceRuntimeMcpStatus["state"], DiagnosticsStatus>;

const MCP_FAILED_STATUS: DiagnosticsStatus = { health: "failed", label: "Failed" };

const buildRuntimeMcpModel = (
  input: BuildDiagnosticsPanelModelInput,
  check: WorkspaceRuntimeMcpCheck | null,
  readError: string | null,
): DiagnosticsRuntimeMcpModel => {
  const entries =
    check?.runtimes.map((status) =>
      buildRuntimeMcpEntry(
        status,
        runtimeLabel(input.runtimeDefinitions, status.kind),
        input.runtimeStatus.statusByKind[status.kind]?.runtimeId ?? null,
      ),
    ) ?? [];
  if (readError !== null) {
    const model: DiagnosticsRuntimeMcpModel = {
      status: refreshFailureStatus("error"),
      errors: [refreshFailureMessage(RUNTIME_MCP_TITLE, readError)],
      entries,
    };
    if (check !== null) {
      model.notice = earlierResultNotice(check.checkedAt);
    }
    return model;
  }
  if (check === null) {
    return {
      status: LOADING_STATUS,
      errors: [],
      emptyMessage: "Connection check is loading.",
      entries,
    };
  }
  const errors = entries.flatMap((entry) =>
    entry.observations.flatMap((observation) =>
      observation.error === null
        ? []
        : [`${entry.label} in ${observation.workingDirectory}: ${observation.error}`],
    ),
  );
  let status: DiagnosticsStatus;
  if (errors.length > 0) {
    status = { health: "failed", label: "Issue" };
  } else if (entries.some((entry) => entry.status.health === "ok")) {
    status = MCP_STATE_STATUSES.observed;
  } else {
    status = MCP_STATE_STATUSES.not_checked;
  }
  return { status, errors, entries };
};

const buildRuntimeMcpEntry = (
  status: WorkspaceRuntimeMcpStatus,
  label: string,
  currentRuntimeId: string | null,
): DiagnosticsRuntimeMcpEntryModel => {
  if (status.runtimeId !== null && status.runtimeId !== currentRuntimeId) {
    // Observations of a replaced or stopped runtime say nothing about the current one.
    return {
      kind: status.kind,
      label,
      status: MCP_STATE_STATUSES.unavailable,
      detail:
        "These connections were observed on an earlier runtime. Refresh checks to observe the current runtime.",
      observations: [],
    };
  }
  const observations =
    status.state === "observed" ? status.observations.map(buildMcpObservation) : [];
  const hasFailedObservation = observations.some(
    (observation) => observation.status.health === "failed",
  );
  return {
    kind: status.kind,
    label,
    status: hasFailedObservation ? MCP_FAILED_STATUS : MCP_STATE_STATUSES[status.state],
    detail: status.detail,
    observations,
  };
};

const buildMcpObservation = (
  observation: WorkspaceRuntimeMcpStatus["observations"][number],
): DiagnosticsMcpObservationModel => {
  const isConnected = observation.state === "connected";
  const rows: DiagnosticKeyValueRowModel[] = [];
  if (observation.serverStatus !== null) {
    rows.push({ label: "Server status", value: observation.serverStatus });
  }
  rows.push({ label: "Tools detected", value: String(observation.toolIds.length), mono: true });
  return {
    key: observation.workingDirectory,
    workingDirectory: observation.workingDirectory,
    status: isConnected ? MCP_STATE_STATUSES.observed : MCP_FAILED_STATUS,
    rows,
    error: isConnected
      ? null
      : (observation.detail ?? "The OpenDucktor MCP connection failed for this directory."),
  };
};
