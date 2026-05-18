import {
  type RepoConfig,
  type TaskWorktreeSummary,
  taskWorktreeSummarySchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../../ports/settings-config-port";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";

export type TaskWorktreeServiceError =
  | HostValidationError
  | SettingsConfigError
  | WorkspaceSettingsError;

export type TaskWorktreeService = {
  getTaskWorktree(
    input: TaskWorktreeInput,
  ): Effect.Effect<TaskWorktreeSummary | null, TaskWorktreeServiceError>;
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
  getTaskWorktree(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const worktreePath = settingsConfig.join(
        resolveWorktreeBasePath(settingsConfig, repoConfig),
        taskId,
      );
      if (!(yield* settingsConfig.pathExists(worktreePath))) {
        return null;
      }
      const canonicalRepoPath = yield* settingsConfig.canonicalizePath(repoConfig.repoPath);
      const canonicalWorktreePath = yield* settingsConfig.canonicalizePath(worktreePath);
      if (canonicalWorktreePath === canonicalRepoPath) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Builder continuation cannot start until a builder worktree exists for task ${taskId}. The resolved worktree points to the repository root.`,
          }),
        );
      }
      return yield* Effect.try({
        try: () =>
          taskWorktreeSummarySchema.parse({
            workingDirectory: worktreePath,
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
});
