import type { RepoStoreHealth, TaskStoreCheck, WorkspaceRecord } from "@openducktor/contracts";
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
  buildRefreshFailedCheck,
  LOADING_STATUS,
  refreshFailureMessage,
} from "./diagnostics-check-section";
import type {
  BuildDiagnosticsPanelModelInput,
  DiagnosticsCheckBase,
  DiagnosticsCheckModel,
  DiagnosticsDetailModel,
  DiagnosticsStatus,
  DiagnosticsWorkspaceModel,
} from "./diagnostics-panel-model";

export const NO_WORKSPACE_MESSAGE = "Select a workspace to view workspace checks.";

const TASK_STORE_TITLE = "Task store";

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
  const taskStore = buildTaskStoreCheck(taskStoreRead);
  const repositorySetup = buildRepositorySetupCheck(workspace);

  const reasons: string[] = [];
  // A failed refresh takes priority over a retained earlier result.
  const repoStoreHealth = getRepoStoreHealth(taskStoreRead.data);
  if (taskStoreRead.error !== null) {
    reasons.push(refreshFailureMessage(TASK_STORE_TITLE, taskStoreRead.error));
  } else if (repoStoreHealth !== null && hasTaskStoreCheckFailure(taskStoreRead.data)) {
    reasons.push(getRepoStoreDetail(repoStoreHealth));
  }
  return {
    model: {
      kind: "selected",
      name: workspace.workspaceName,
      path: workspace.repoPath,
      checks: [repositorySetup, taskStore],
    },
    reasons,
    isLoading: taskStore.status.health === "loading",
    hasWarning: workspace.effectiveWorktreeBasePath === null,
  };
};

const buildRepositorySetupCheck = (workspace: WorkspaceRecord): DiagnosticsCheckModel => {
  const worktreePath = workspace.effectiveWorktreeBasePath;
  return {
    key: "repository-setup",
    title: "Repository setup",
    status:
      worktreePath !== null
        ? { health: "ok", label: "Configured" }
        : { health: "warning", label: "Needs setup" },
    value: null,
    details:
      worktreePath !== null ? [{ label: "Worktrees", value: worktreePath, isPath: true }] : [],
    notice: null,
    errors: worktreePath === null ? ["Configure the worktree path in repository settings."] : [],
  };
};

const buildTaskStoreCheck = (read: ObservedCheck<TaskStoreCheck>): DiagnosticsCheckModel => {
  const repoStoreHealth = getRepoStoreHealth(read.data);
  const base: DiagnosticsCheckBase = {
    key: "task-store",
    title: TASK_STORE_TITLE,
    value: null,
    details: repoStoreHealth === null ? [] : buildTaskStoreDetails(repoStoreHealth),
  };
  if (read.error !== null) {
    return buildRefreshFailedCheck(
      base,
      { error: read.error, failureKind: read.failureKind },
      repoStoreHealth === null ? null : read.observedAt,
    );
  }
  if (repoStoreHealth === null) {
    return { ...base, status: LOADING_STATUS, notice: null, errors: [] };
  }
  return {
    ...base,
    status: getTaskStoreStatus(repoStoreHealth),
    notice: null,
    errors: isRepoStoreReady(repoStoreHealth) ? [] : [getRepoStoreDetail(repoStoreHealth)],
  };
};

const getTaskStoreStatus = (repoStoreHealth: RepoStoreHealth): DiagnosticsStatus => {
  const label = getRepoStoreStatusLabel(repoStoreHealth);
  switch (repoStoreHealth.status) {
    case "ready":
      return { health: "ok", label };
    case "degraded":
      return { health: "warning", label };
    case "blocking":
      return { health: "failed", label };
  }
};

const buildTaskStoreDetails = (repoStoreHealth: RepoStoreHealth): DiagnosticsDetailModel[] => {
  const details: DiagnosticsDetailModel[] = [];
  if (!isRepoStoreReady(repoStoreHealth)) {
    details.push({
      label: "Health",
      value: getRepoStoreCategoryLabel(repoStoreHealth),
      isPath: false,
    });
  }
  details.push({
    label: "Database",
    value: repoStoreHealth.databasePath ?? "Unavailable",
    isPath: repoStoreHealth.databasePath !== null,
  });
  return details;
};
