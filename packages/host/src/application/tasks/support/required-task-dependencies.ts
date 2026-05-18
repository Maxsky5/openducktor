import { Effect } from "effect";
import { errorMessage, HostDependencyError } from "../../../effect/host-errors";
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

const missingTaskDependency = (message: string): HostDependencyError =>
  new HostDependencyError({
    dependency: "task dependency",
    message,
  });
export const requireDependencies = <A>(resolve: () => A): Effect.Effect<A, HostDependencyError> =>
  Effect.try({
    try: resolve,
    catch: (cause) =>
      cause instanceof HostDependencyError
        ? cause
        : new HostDependencyError({
            dependency: "task dependency",
            message: errorMessage(cause),
            cause,
          }),
  });
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
    throw missingTaskDependency("Settings config port is required for agent_session_upsert.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for agent_session_upsert.");
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
    throw missingTaskDependency("Settings config port is required for build_completed.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for build_completed.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for build_completed.");
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
    configureBranchUpstream: GitPort["configureBranchUpstream"];
    deleteReference: GitPort["deleteReference"];
    referenceExists: GitPort["referenceExists"];
  };
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: RuntimeRegistryPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  worktreeFiles: WorktreeFilePort & {
    ensureDirectory: WorktreeFilePort["ensureDirectory"];
  };
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for build_start.");
  }
  if (!runtimeDefinitionsService) {
    throw missingTaskDependency("Runtime definitions service is required for build_start.");
  }
  if (!runtimeRegistry) {
    throw missingTaskDependency("Runtime registry port is required for build_start.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for build_start.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for build_start.");
  }
  if (!worktreeFiles) {
    throw missingTaskDependency("Worktree file port is required for build_start.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for build_start.");
  }
  return {
    gitPort: gitPort as GitPort & {
      configureBranchUpstream: GitPort["configureBranchUpstream"];
      deleteReference: GitPort["deleteReference"];
      referenceExists: GitPort["referenceExists"];
    },
    runtimeDefinitionsService,
    runtimeRegistry,
    settingsConfig,
    systemCommands,
    worktreeFiles: worktreeFiles as WorktreeFilePort & {
      ensureDirectory: WorktreeFilePort["ensureDirectory"];
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
    throw missingTaskDependency("Dev server service is required for task_direct_merge_complete.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_direct_merge_complete.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_direct_merge_complete.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency(
      "Task worktree service is required for task_direct_merge_complete.",
    );
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
    throw missingTaskDependency("Dev server service is required for task_direct_merge.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_direct_merge.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_direct_merge.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for task_direct_merge.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_direct_merge.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_direct_merge.");
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
    throw missingTaskDependency(
      "Dev server service is required for task_pull_request_link_merged.",
    );
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_pull_request_link_merged.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency(
      "Settings config port is required for task_pull_request_link_merged.",
    );
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency(
      "Task worktree service is required for task_pull_request_link_merged.",
    );
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_link_merged.",
    );
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
    throw missingTaskDependency("Git port is required for task_approval_context_get.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_approval_context_get.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_approval_context_get.",
    );
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
    throw missingTaskDependency("Git port is required for task_pull_request_detect.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for task_pull_request_detect.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_detect.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_detect.",
    );
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
    throw missingTaskDependency("Git port is required for task_pull_request_link.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for task_pull_request_link.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_link.",
    );
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
    throw missingTaskDependency("Git port is required for task_pull_request_upsert.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_pull_request_upsert.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for task_pull_request_upsert.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_upsert.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_upsert.",
    );
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
    throw missingTaskDependency("System command port is required for repo_pull_request_sync.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for repo_pull_request_sync.",
    );
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
    throw missingTaskDependency("Dev server service is required for repo_pull_request_sync.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for repo_pull_request_sync.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for repo_pull_request_sync.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for repo_pull_request_sync.");
  }

  return { devServerService, gitPort, settingsConfig, taskWorktreeService };
};
