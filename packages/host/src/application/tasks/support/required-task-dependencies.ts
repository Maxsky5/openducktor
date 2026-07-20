import { Effect } from "effect";
import { errorMessage, HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import {
  createGithubCommandDependencies,
  type GithubCommandDependencies,
  type GithubRepositoryDependencies,
} from "./github-pull-requests";

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
type GithubCommandDependencyInput = {
  systemCommands?: SystemCommandPort;
  toolDiscovery?: ToolDiscoveryPort;
};
type GithubRepositoryDependencyInput = GithubCommandDependencyInput & {
  gitPort?: GitPort;
};
export type TaskGithubDependencies = {
  command: GithubCommandDependencies | undefined;
  commandMissingDependency: string | undefined;
  repository: GithubRepositoryDependencies | undefined;
  repositoryMissingDependency: string | undefined;
};
export type TaskGithubDependencyInput = {
  githubDependencies: TaskGithubDependencies;
};
export const createTaskGithubDependencies = ({
  gitPort,
  systemCommands,
  toolDiscovery,
}: GithubRepositoryDependencyInput): TaskGithubDependencies => {
  const commandMissingDependency =
    systemCommands === undefined
      ? "System command port"
      : toolDiscovery === undefined
        ? "Tool discovery port"
        : undefined;
  const command =
    systemCommands === undefined || toolDiscovery === undefined
      ? undefined
      : createGithubCommandDependencies({ systemCommands, toolDiscovery });
  const repositoryMissingDependency = gitPort === undefined ? "Git port" : commandMissingDependency;
  const repository =
    gitPort === undefined || command === undefined
      ? undefined
      : {
          gitPort,
          ...command,
        };
  return {
    command,
    commandMissingDependency,
    repository,
    repositoryMissingDependency,
  };
};
const requireGithubCommandDependencies = (
  githubDependencies: TaskGithubDependencies,
  operation: string,
): GithubCommandDependencies => {
  if (!githubDependencies.command) {
    throw missingTaskDependency(
      `${githubDependencies.commandMissingDependency ?? "GitHub command dependencies"} is required for ${operation}.`,
    );
  }
  return githubDependencies.command;
};
const requireGithubRepositoryDependencies = (
  githubDependencies: TaskGithubDependencies,
  operation: string,
): GithubRepositoryDependencies => {
  if (!githubDependencies.repository) {
    throw missingTaskDependency(
      `${githubDependencies.repositoryMissingDependency ?? "GitHub repository dependencies"} is required for ${operation}.`,
    );
  }
  return githubDependencies.repository;
};
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
type MergedBuilderCleanupDependencies = {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
};
type MergedBuilderCleanupDependencyInput = {
  [Key in keyof MergedBuilderCleanupDependencies]:
    | MergedBuilderCleanupDependencies[Key]
    | undefined;
};
export const requireMergedBuilderCleanupDependencies = (
  {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    terminalService,
  }: MergedBuilderCleanupDependencyInput,
  operation: "repo_pull_request_sync" | "task_direct_merge_complete",
): MergedBuilderCleanupDependencies => {
  if (!devServerService) {
    throw missingTaskDependency(`Dev server service is required for ${operation}.`);
  }
  if (!gitPort) {
    throw missingTaskDependency(`Git port is required for ${operation}.`);
  }
  if (!settingsConfig) {
    throw missingTaskDependency(`Settings config port is required for ${operation}.`);
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency(`Task worktree service is required for ${operation}.`);
  }
  if (!terminalService) {
    throw missingTaskDependency(`Terminal service is required for ${operation}.`);
  }
  return { devServerService, gitPort, settingsConfig, taskWorktreeService, terminalService };
};
export const requireDirectMergeDependencies = ({
  devServerService,
  githubDependencies,
  settingsConfig,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
}: {
  devServerService: DevServerService | undefined;
  githubDependencies: TaskGithubDependencies;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  terminalService: TaskTerminalCleanupPort | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  devServerService: DevServerService;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!devServerService) {
    throw missingTaskDependency("Dev server service is required for task_direct_merge.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_direct_merge.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_direct_merge.");
  }
  if (!terminalService) {
    throw missingTaskDependency("Terminal service is required for task_direct_merge.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_direct_merge.");
  }
  const githubRepositoryDependencies = requireGithubRepositoryDependencies(
    githubDependencies,
    "task_direct_merge",
  );
  return {
    devServerService,
    ...githubRepositoryDependencies,
    settingsConfig,
    taskWorktreeService,
    terminalService,
    workspaceSettingsService,
  };
};
export const requireLinkMergedPullRequestDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  terminalService: TaskTerminalCleanupPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
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
  if (!terminalService) {
    throw missingTaskDependency("Terminal service is required for task_pull_request_link_merged.");
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
    terminalService,
    workspaceSettingsService,
  };
};
export const requireApprovalContextDependencies = ({
  githubDependencies,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_approval_context_get.",
    );
  }
  const githubRepositoryDependencies = requireGithubRepositoryDependencies(
    githubDependencies,
    "task_approval_context_get",
  );
  return {
    ...githubRepositoryDependencies,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requirePullRequestDetectionDependencies = ({
  githubDependencies,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_detect.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_detect.",
    );
  }
  const githubRepositoryDependencies = requireGithubRepositoryDependencies(
    githubDependencies,
    "task_pull_request_detect",
  );
  return {
    ...githubRepositoryDependencies,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requirePullRequestLinkDependencies = ({
  githubDependencies,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_link.",
    );
  }
  const githubRepositoryDependencies = requireGithubRepositoryDependencies(
    githubDependencies,
    "task_pull_request_link",
  );
  return {
    ...githubRepositoryDependencies,
    workspaceSettingsService,
  };
};
export const requirePullRequestUpsertDependencies = ({
  githubDependencies,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_pull_request_upsert.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_upsert.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_upsert.",
    );
  }
  const githubRepositoryDependencies = requireGithubRepositoryDependencies(
    githubDependencies,
    "task_pull_request_upsert",
  );
  return {
    ...githubRepositoryDependencies,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

export const requirePullRequestSyncDependencies = ({
  githubDependencies,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubCommandDependencies => {
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for repo_pull_request_sync.",
    );
  }
  const githubCommandDependencies = requireGithubCommandDependencies(
    githubDependencies,
    "repo_pull_request_sync",
  );

  return { ...githubCommandDependencies, workspaceSettingsService };
};
