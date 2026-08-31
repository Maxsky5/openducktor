import { HostDependencyError } from "../../../effect/host-errors";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { GitProviderResolver } from "../../git/git-provider-resolver";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import type { GithubRepositoryDependencies } from "./github-pull-requests";
import type { TaskGithubDependencies } from "./required-task-dependencies";

const missingDependency = (message: string) =>
  new HostDependencyError({ dependency: "task dependency", message });

export const requireApprovalContextDependencies = ({
  gitProviderResolver,
  githubDependencies,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  githubDependencies: TaskGithubDependencies;
  gitProviderResolver: GitProviderResolver | undefined;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}): {
  settingsConfig: SettingsConfigPort;
  gitProviderResolver: GitProviderResolver;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} & GithubRepositoryDependencies => {
  if (!settingsConfig) {
    throw missingDependency("Settings config port is required for task_approval_context_get.");
  }
  if (!gitProviderResolver) {
    throw missingDependency("Git provider resolver is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw missingDependency("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw missingDependency(
      "Workspace settings service is required for task_approval_context_get.",
    );
  }
  const githubRepositoryDependencies = githubDependencies.repository;
  if (!githubRepositoryDependencies) {
    throw missingDependency(
      `${githubDependencies.repositoryMissingDependency ?? "GitHub repository dependencies"} is required for task_approval_context_get.`,
    );
  }
  return {
    ...githubRepositoryDependencies,
    gitProviderResolver,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};
