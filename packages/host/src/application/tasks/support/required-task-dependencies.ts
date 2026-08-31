import { Effect } from "effect";
import {
  errorMessage,
  HostDependencyError,
  type HostDependencyErrorAggregate,
} from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { GithubCommandResolverPort } from "../../../ports/github-cli-port";
import type { RuntimeRegistryPort } from "../../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../../ports/worktree-file-port";
import type { DevServerService } from "../../dev-servers/dev-server-service";
import type { GitProviderResolver } from "../../git/git-provider-resolver";
import type { RuntimeDefinitionsService } from "../../runtimes/runtime-definitions-service";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskTerminalCleanupPort } from "../task-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";

const missingTaskDependency = (message: string): HostDependencyError =>
  new HostDependencyError({
    dependency: "task dependency",
    message,
  });
export const requireDependencies = <A>(
  resolve: () => A,
): Effect.Effect<A, HostDependencyErrorAggregate> =>
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
const requireGithubCommandResolver = (
  githubCommands: GithubCommandResolverPort | undefined,
  operation: string,
): GithubCommandResolverPort => {
  if (!githubCommands) {
    throw missingTaskDependency(`GitHub command resolver is required for ${operation}.`);
  }
  return githubCommands;
};
export const requireAgentSessionDependencies = (
  taskStore: TaskStorePort,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
) => {
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
  } satisfies {
    upsertAgentSession: TaskStorePort["upsertAgentSession"];
    settingsConfig: SettingsConfigPort;
    workspaceSettingsService: WorkspaceSettingsService;
  };
};
export const requireBuildCompletedDependencies = (
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
) => {
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for build_completed.");
  }
  if (!systemCommands) {
    throw missingTaskDependency("System command port is required for build_completed.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for build_completed.");
  }
  return { settingsConfig, systemCommands, workspaceSettingsService } satisfies {
    settingsConfig: SettingsConfigPort;
    systemCommands: SystemCommandPort;
    workspaceSettingsService: WorkspaceSettingsService;
  };
};
export const requireBuildStartDependencies = (
  gitPort: GitPort | undefined,
  runtimeDefinitionsService: RuntimeDefinitionsService | undefined,
  runtimeRegistry: RuntimeRegistryPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  worktreeFiles: WorktreeFilePort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
) => {
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
    gitPort,
    runtimeDefinitionsService,
    runtimeRegistry,
    settingsConfig,
    systemCommands,
    worktreeFiles,
    workspaceSettingsService,
  } satisfies {
    gitPort: GitPort;
    runtimeDefinitionsService: RuntimeDefinitionsService;
    runtimeRegistry: RuntimeRegistryPort;
    settingsConfig: SettingsConfigPort;
    systemCommands: SystemCommandPort;
    worktreeFiles: WorktreeFilePort;
    workspaceSettingsService: WorkspaceSettingsService;
  };
};
type MergedTaskCleanupDependencies = {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  terminalService: TaskTerminalCleanupPort;
  worktreeFiles?: WorktreeFilePort;
};
type MergedTaskCleanupDependencyInput = {
  [Key in keyof MergedTaskCleanupDependencies]: MergedTaskCleanupDependencies[Key] | undefined;
};
export const requireMergedTaskCleanupDependencies = (
  {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    terminalService,
    worktreeFiles,
  }: MergedTaskCleanupDependencyInput,
  operation: "repo_pull_request_sync" | "task_direct_merge_complete",
): MergedTaskCleanupDependencies => {
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
  const dependencies: MergedTaskCleanupDependencies = {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    terminalService,
  };
  if (worktreeFiles) {
    dependencies.worktreeFiles = worktreeFiles;
  }
  return dependencies;
};
export const requireDirectMergeDependencies = ({
  devServerService,
  gitPort,
  gitProviderResolver,
  settingsConfig,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
}: {
  devServerService: DevServerService | undefined;
  gitPort: GitPort | undefined;
  gitProviderResolver: GitProviderResolver | undefined;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  terminalService: TaskTerminalCleanupPort | undefined;
  worktreeFiles: WorktreeFilePort | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): MergedTaskCleanupDependencies & {
  gitProviderResolver: GitProviderResolver;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw missingTaskDependency("Dev server service is required for task_direct_merge.");
  }
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_direct_merge.");
  }
  if (!gitProviderResolver) {
    throw missingTaskDependency("Git provider resolver is required for task_direct_merge.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_direct_merge.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_direct_merge.");
  }
  if (!terminalService) {
    throw missingTaskDependency("Terminal service is required for task_direct_merge.");
  }
  if (!worktreeFiles) {
    throw missingTaskDependency("Worktree file port is required for task_direct_merge.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency("Workspace settings service is required for task_direct_merge.");
  }
  return {
    devServerService,
    gitPort,
    gitProviderResolver,
    settingsConfig,
    taskWorktreeService,
    terminalService,
    worktreeFiles,
    workspaceSettingsService,
  };
};
export const requireLinkMergedPullRequestDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  terminalService: TaskTerminalCleanupPort | undefined,
  worktreeFiles: WorktreeFilePort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): MergedTaskCleanupDependencies & {
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
  const dependencies: MergedTaskCleanupDependencies & {
    workspaceSettingsService: WorkspaceSettingsService;
  } = {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    terminalService,
    workspaceSettingsService,
  };
  if (worktreeFiles) {
    dependencies.worktreeFiles = worktreeFiles;
  }
  return dependencies;
};
export const requirePullRequestDetectionDependencies = ({
  gitPort,
  gitProviderResolver,
  githubCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  gitPort: GitPort | undefined;
  gitProviderResolver: GitProviderResolver | undefined;
  githubCommands: GithubCommandResolverPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  gitPort: GitPort;
  gitProviderResolver: GitProviderResolver;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubCommandResolverPort => {
  if (!gitProviderResolver) {
    throw missingTaskDependency("Git provider resolver is required for task_pull_request_detect.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_pull_request_detect.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_detect.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_detect.",
    );
  }
  const githubCommandResolver = requireGithubCommandResolver(
    githubCommands,
    "task_pull_request_detect",
  );
  return {
    ...githubCommandResolver,
    gitPort,
    gitProviderResolver,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
export const requirePullRequestLinkDependencies = ({
  gitProviderResolver,
  githubCommands,
  workspaceSettingsService,
}: {
  gitProviderResolver: GitProviderResolver | undefined;
  githubCommands: GithubCommandResolverPort | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  gitProviderResolver: GitProviderResolver;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubCommandResolverPort => {
  if (!gitProviderResolver) {
    throw missingTaskDependency("Git provider resolver is required for task_pull_request_link.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_link.",
    );
  }
  const githubCommandResolver = requireGithubCommandResolver(
    githubCommands,
    "task_pull_request_link",
  );
  return {
    ...githubCommandResolver,
    gitProviderResolver,
    workspaceSettingsService,
  };
};
export const requirePullRequestUpsertDependencies = ({
  gitPort,
  gitProviderResolver,
  githubCommands,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  gitPort: GitPort | undefined;
  githubCommands: GithubCommandResolverPort | undefined;
  gitProviderResolver: GitProviderResolver | undefined;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  gitProviderResolver: GitProviderResolver;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubCommandResolverPort => {
  if (!settingsConfig) {
    throw missingTaskDependency("Settings config port is required for task_pull_request_upsert.");
  }
  if (!gitProviderResolver) {
    throw missingTaskDependency("Git provider resolver is required for task_pull_request_upsert.");
  }
  if (!gitPort) {
    throw missingTaskDependency("Git port is required for task_pull_request_upsert.");
  }
  if (!taskWorktreeService) {
    throw missingTaskDependency("Task worktree service is required for task_pull_request_upsert.");
  }
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for task_pull_request_upsert.",
    );
  }
  const githubCommandResolver = requireGithubCommandResolver(
    githubCommands,
    "task_pull_request_upsert",
  );
  return {
    ...githubCommandResolver,
    gitPort,
    gitProviderResolver,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

export const requirePullRequestSyncDependencies = ({
  githubCommands,
  workspaceSettingsService,
}: {
  githubCommands: GithubCommandResolverPort | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubCommandResolverPort => {
  if (!workspaceSettingsService) {
    throw missingTaskDependency(
      "Workspace settings service is required for repo_pull_request_sync.",
    );
  }
  const githubCommandResolver = requireGithubCommandResolver(
    githubCommands,
    "repo_pull_request_sync",
  );

  return { ...githubCommandResolver, workspaceSettingsService };
};
