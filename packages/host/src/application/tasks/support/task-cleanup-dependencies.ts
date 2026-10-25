import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";

const missingTaskDependency = (message: string): HostDependencyError =>
  new HostDependencyError({
    dependency: "task dependency",
    message,
  });

type TaskCleanupDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
};

export const requireTaskDeleteDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): TaskCleanupDependencies => {
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_delete.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_delete.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_delete.");
  }

  return { gitPort, settingsConfig, workspaceSettingsService };
};

export const requireTaskCloseDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): TaskCleanupDependencies => {
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_close.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_close.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_close.");
  }

  return { gitPort, settingsConfig, workspaceSettingsService };
};

export const requireTaskCloseWorktreeService = (
  taskWorktreeService: TaskWorktreeService | undefined,
): TaskWorktreeService => {
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_close.");
  }
  return taskWorktreeService;
};

export const requireImplementationResetStoreDependencies = (taskStore: TaskStorePort) =>
  ({
    clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
    clearWorkflowArtifacts: taskStore.clearWorkflowArtifacts.bind(taskStore),
    setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
    setPullRequest: taskStore.setPullRequest.bind(taskStore),
  }) satisfies {
    clearAgentSessionsByRoles: TaskStorePort["clearAgentSessionsByRoles"];
    clearWorkflowArtifacts: TaskStorePort["clearWorkflowArtifacts"];
    setDirectMerge: TaskStorePort["setDirectMerge"];
    setPullRequest: TaskStorePort["setPullRequest"];
  };
