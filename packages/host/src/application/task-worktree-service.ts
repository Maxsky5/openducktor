import {
  type RepoConfig,
  type TaskWorktreeSummary,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

export type TaskWorktreeService = {
  getTaskWorktree(input: unknown): Promise<TaskWorktreeSummary | null>;
};

export type CreateTaskWorktreeServiceInput = {
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
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
    const record = requireRecord(input, "task_worktree_get input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
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
