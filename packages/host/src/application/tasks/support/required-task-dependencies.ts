import type { GitPort } from "../../../ports/git-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
export const requireAgentSessionDependencies = (
  taskStore: TaskStorePort,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  upsertAgentSession: TaskStorePort["upsertAgentSession"];
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!settingsConfig) {
    throw new Error("Settings config port is required for agent_session_upsert.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for agent_session_upsert.");
  }
  return {
    upsertAgentSession: taskStore.upsertAgentSession.bind(taskStore),
    settingsConfig,
    workspaceSettingsService,
  };
};
export const requireBuildCompletedDependencies = (
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!settingsConfig) {
    throw new Error("Settings config port is required for build_completed.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for build_completed.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for build_completed.");
  }
  return { settingsConfig, systemCommands, workspaceSettingsService };
};
export const requireBuildStartDependencies = (
  gitPort: GitPort | undefined,
  runtimeDefinitionsService: RuntimeDefinitionsService | undefined,
  runtimeRegistry: RuntimeRegistryPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  worktreeFiles: WorktreeFilePort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort & {
    configureBranchUpstream: NonNullable<GitPort["configureBranchUpstream"]>;
    deleteReference: NonNullable<GitPort["deleteReference"]>;
    referenceExists: NonNullable<GitPort["referenceExists"]>;
  };
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: RuntimeRegistryPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  worktreeFiles: WorktreeFilePort & {
    ensureDirectory: NonNullable<WorktreeFilePort["ensureDirectory"]>;
  };
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for build_start.");
  }
  if (!gitPort.referenceExists) {
    throw new Error("Git port is required to support build_start reference checks.");
  }
  if (!gitPort.configureBranchUpstream) {
    throw new Error("Git port is required to support build_start upstream setup.");
  }
  if (!gitPort.deleteReference) {
    throw new Error("Git port is required to support build_start upstream cleanup.");
  }
  if (!runtimeDefinitionsService) {
    throw new Error("Runtime definitions service is required for build_start.");
  }
  if (!runtimeRegistry) {
    throw new Error("Runtime registry port is required for build_start.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for build_start.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for build_start.");
  }
  if (!worktreeFiles) {
    throw new Error("Worktree file port is required for build_start.");
  }
  if (!worktreeFiles.ensureDirectory) {
    throw new Error("Worktree file port is required to support build_start directory creation.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for build_start.");
  }
  return {
    gitPort: gitPort as GitPort & {
      configureBranchUpstream: NonNullable<GitPort["configureBranchUpstream"]>;
      deleteReference: NonNullable<GitPort["deleteReference"]>;
      referenceExists: NonNullable<GitPort["referenceExists"]>;
    },
    runtimeDefinitionsService,
    runtimeRegistry,
    settingsConfig,
    systemCommands,
    worktreeFiles: worktreeFiles as WorktreeFilePort & {
      ensureDirectory: NonNullable<WorktreeFilePort["ensureDirectory"]>;
    },
    workspaceSettingsService,
  };
};
export const requireDirectMergeCompleteDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_direct_merge_complete.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_direct_merge_complete.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_direct_merge_complete.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_direct_merge_complete.");
  }
  return { devServerService, gitPort, settingsConfig, taskWorktreeService };
};
export const requireDirectMergeDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_direct_merge.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_direct_merge.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_direct_merge.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_direct_merge.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_direct_merge.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_direct_merge.");
  }
  return {
    devServerService,
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requireLinkMergedPullRequestDependencies = (
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
    throw new Error("Dev server service is required for task_pull_request_link_merged.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_link_merged.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_pull_request_link_merged.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_link_merged.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_link_merged.");
  }
  return {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requireApprovalContextDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_approval_context_get.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_approval_context_get.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_approval_context_get.");
  }
  return {
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requirePullRequestDetectionDependencies = (
  gitPort: GitPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_detect.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_detect.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_detect.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_detect.");
  }
  return {
    gitPort,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requirePullRequestLinkDependencies = (
  gitPort: GitPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_link.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_link.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_link.");
  }
  return {
    gitPort,
    systemCommands,
    workspaceSettingsService,
  };
};
export const requirePullRequestUpsertDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_upsert.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_pull_request_upsert.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_upsert.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_upsert.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_upsert.");
  }
  return {
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

export const requirePullRequestSyncDependencies = (
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!systemCommands) {
    throw new Error("System command port is required for repo_pull_request_sync.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for repo_pull_request_sync.");
  }

  return { systemCommands, workspaceSettingsService };
};

export const requirePullRequestMergeCleanupDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for repo_pull_request_sync.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for repo_pull_request_sync.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for repo_pull_request_sync.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for repo_pull_request_sync.");
  }

  return { devServerService, gitPort, settingsConfig, taskWorktreeService };
};

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
    throw new Error("Dev server service is required for task_delete.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_delete.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_delete.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_delete.");
  }

  return { devServerService, gitPort, settingsConfig, workspaceSettingsService };
};

export const requireTaskWorktreeCleanupFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
  operation: "task_delete" | "task_reset" | "task_reset_implementation",
): WorktreeFilePort => {
  if (!worktreeFiles) {
    throw new Error(`Worktree file port is required for ${operation}.`);
  }

  return worktreeFiles;
};

export const requireImplementationResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: TaskStorePort["clearAgentSessionsByRoles"];
  clearQaReports: TaskStorePort["clearQaReports"];
  setDirectMerge: TaskStorePort["setDirectMerge"];
  setPullRequest: TaskStorePort["setPullRequest"];
} => {
  return {
    clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
    clearQaReports: taskStore.clearQaReports.bind(taskStore),
    setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
    setPullRequest: taskStore.setPullRequest.bind(taskStore),
  };
};

export const requireTaskResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: TaskStorePort["clearAgentSessionsByRoles"];
  clearWorkflowDocuments: TaskStorePort["clearWorkflowDocuments"];
  setDirectMerge: TaskStorePort["setDirectMerge"];
  setPullRequest: TaskStorePort["setPullRequest"];
} => {
  return {
    clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
    clearWorkflowDocuments: taskStore.clearWorkflowDocuments.bind(taskStore),
    setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
    setPullRequest: taskStore.setPullRequest.bind(taskStore),
  };
};
