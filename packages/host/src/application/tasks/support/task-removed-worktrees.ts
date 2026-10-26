import type {
  AgentSessionRecord,
  RepoConfig,
  TaskCard,
  TaskStopImpactOperation,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { collectCloseWorktreePaths } from "./task-close-cleanup";
import {
  collectDeleteWorktreePaths,
  collectResetWorktreePaths,
  managedWorktreeBaseForRepoConfig,
  workflowCleanupSessionRoles,
} from "./task-cleanup-support";

export type RemovedWorktreeOperation = Exclude<TaskStopImpactOperation, "reset_implementation">;

export type RemovedWorktreeTarget = {
  task: TaskCard;
  taskId: string;
  sessions: AgentSessionRecord[];
};

type RemovedWorktreeDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService;
};

// Keep these path lists in step with Close, Delete, and Reset Task.
const collectRemovedWorktreePaths = (
  { taskWorktreeService, ...dependencies }: RemovedWorktreeDependencies,
  operation: RemovedWorktreeOperation,
  repoConfig: RepoConfig,
  repoPath: string,
  targets: RemovedWorktreeTarget[],
) =>
  Effect.gen(function* () {
    const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
      dependencies.settingsConfig,
      repoConfig,
    );
    if (operation === "delete") {
      return yield* collectDeleteWorktreePaths(
        dependencies,
        repoPath,
        managedWorktreeBasePath,
        targets,
      );
    }
    if (operation === "reset_task") {
      const paths = yield* Effect.forEach(targets, ({ taskId, sessions }) =>
        collectResetWorktreePaths(
          dependencies,
          repoPath,
          managedWorktreeBasePath,
          taskId,
          sessions,
          workflowCleanupSessionRoles,
          "reset task",
        ),
      );
      return paths.flat();
    }
    const closeDependencies = taskWorktreeService
      ? { ...dependencies, taskWorktreeService }
      : dependencies;
    // Close returns early for a closed task, so it removes nothing there.
    const paths = yield* Effect.forEach(
      targets.filter(({ task }) => task.status !== "closed"),
      ({ task, sessions }) =>
        collectCloseWorktreePaths(closeDependencies, repoPath, task, sessions),
    );
    return paths.flat();
  });

/**
 * Counts the existing task worktrees that Close, Delete, or Reset Task removes. A worktree that
 * the workflow or the user already removed does not count.
 */
export const countRemovedWorktrees = (
  dependencies: RemovedWorktreeDependencies,
  operation: RemovedWorktreeOperation,
  repoConfig: RepoConfig,
  repoPath: string,
  targets: RemovedWorktreeTarget[],
) =>
  Effect.gen(function* () {
    const paths = yield* collectRemovedWorktreePaths(
      dependencies,
      operation,
      repoConfig,
      repoPath,
      targets,
    );
    const existing = new Set<string>();
    for (const path of paths) {
      if (yield* dependencies.settingsConfig.pathExists(path)) {
        existing.add(normalizePathForComparison(path));
      }
    }
    return existing.size;
  });
