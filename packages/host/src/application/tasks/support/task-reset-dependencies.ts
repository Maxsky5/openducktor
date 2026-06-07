import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";

const missingTaskDependency = (message: string): HostDependencyError =>
  new HostDependencyError({
    dependency: "task dependency",
    message,
  });

export const requireTaskDeleteDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw missingTaskDependency("Dev server service is required for task_delete.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_delete.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_delete.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_delete.");
  }

  return { devServerService, gitPort, settingsConfig, workspaceSettingsService };
};

export const requireTaskWorktreeCleanupFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
  operation: "task_close" | "task_delete" | "task_reset" | "task_reset_implementation",
): WorktreeFilePort => {
  if (!worktreeFiles) {
    throw missingTaskDependency(`Worktree file port is required for ${operation}.`);
  }

  return worktreeFiles;
};

export const requireTaskCloseDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw missingTaskDependency("Dev server service is required for task_close.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_close.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_close.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_close.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_close.");
  }

  return {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

export const requireImplementationResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: TaskStorePort["clearAgentSessionsByRoles"];
  clearQaReports: TaskStorePort["clearQaReports"];
  setDirectMerge: TaskStorePort["setDirectMerge"];
  setPullRequest: TaskStorePort["setPullRequest"];
} => ({
  clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
  clearQaReports: taskStore.clearQaReports.bind(taskStore),
  setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
  setPullRequest: taskStore.setPullRequest.bind(taskStore),
});

export const requireTaskResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: TaskStorePort["clearAgentSessionsByRoles"];
  clearWorkflowDocuments: TaskStorePort["clearWorkflowDocuments"];
  setDirectMerge: TaskStorePort["setDirectMerge"];
  setPullRequest: TaskStorePort["setPullRequest"];
} => ({
  clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
  clearWorkflowDocuments: taskStore.clearWorkflowDocuments.bind(taskStore),
  setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
  setPullRequest: taskStore.setPullRequest.bind(taskStore),
});
