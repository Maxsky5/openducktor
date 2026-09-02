import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { GitProviderResolver } from "../../git/git-provider-resolver";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";

const missingDependency = (message: string) =>
  new HostDependencyError({ dependency: "task dependency", message });

export const requireApprovalContextDependencies = ({
  gitPort,
  gitProviderResolver,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: {
  gitPort: GitPort | undefined;
  gitProviderResolver: GitProviderResolver | undefined;
  settingsConfig: SettingsConfigPort | undefined;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService | undefined;
}) => {
  if (!settingsConfig) {
    throw missingDependency("Settings config port is required for task_approval_context_get.");
  }
  if (!gitProviderResolver) {
    throw missingDependency("Git provider resolver is required for task_approval_context_get.");
  }
  if (!gitPort) {
    throw missingDependency("Git port is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw missingDependency("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw missingDependency(
      "Workspace settings service is required for task_approval_context_get.",
    );
  }
  return {
    gitPort,
    gitProviderResolver,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  } satisfies {
    settingsConfig: SettingsConfigPort;
    gitPort: GitPort;
    gitProviderResolver: GitProviderResolver;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  };
};
