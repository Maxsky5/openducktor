import {
  type RepoConfig,
  type TaskWorktreeSummary,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";

export type TaskWorktreeService = {
  getTaskWorktree(input: TaskWorktreeInput): Promise<TaskWorktreeSummary | null>;
};

export type TaskWorktreeInput = {
  repoPath: string;
  taskId: string;
};

export type CreateTaskWorktreeServiceInput = {
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
};

const resolveWorktreeBasePath = (
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
): string => {
  if (repoConfig.worktreeBasePath !== undefined) {
    return settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
  }

  return settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
};

export const createTaskWorktreeService = ({
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskWorktreeServiceInput): TaskWorktreeService => ({
  async getTaskWorktree(input) {
    const { repoPath, taskId } = input;
    const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const worktreePath = settingsConfig.join(
      resolveWorktreeBasePath(settingsConfig, repoConfig),
      taskId,
    );

    if (!(await settingsConfig.pathExists(worktreePath))) {
      return null;
    }

    const canonicalRepoPath = await settingsConfig.canonicalizePath(repoConfig.repoPath);
    const canonicalWorktreePath = await settingsConfig.canonicalizePath(worktreePath);
    if (canonicalWorktreePath === canonicalRepoPath) {
      throw new Error(
        `Builder continuation cannot start until a builder worktree exists for task ${taskId}. The resolved worktree points to the repository root.`,
      );
    }

    return taskWorktreeSummarySchema.parse({
      workingDirectory: worktreePath,
    });
  },
});
