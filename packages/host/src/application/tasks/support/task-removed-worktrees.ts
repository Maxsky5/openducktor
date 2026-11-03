import type {
  AgentSessionRecord,
  RepoConfig,
  TaskWorktreeOwnersOperation,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import type { GitPort } from "../../../ports/git-port";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import { collectCloseWorktreePaths } from "./task-close-cleanup";
import {
  collectDeleteWorktreePaths,
  collectResetWorktreePaths,
  managedWorktreeBaseForRepoConfig,
  workflowRoleIds,
} from "./task-cleanup-support";

export type RemovedWorktreeOperation = Exclude<TaskWorktreeOwnersOperation, "reset_implementation">;

export type RemovedWorktreeTarget = {
  task: TaskRecord;
  taskId: string;
  sessions: AgentSessionRecord[];
  workflow: TaskWorkflow;
};

type RemovedWorktreeDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService | undefined;
  workspaceSettingsService: WorkspaceSettingsService;
};

// Keep these path lists in step with Close, Delete, Reset Task, and Remove worktree.
export const collectRemovedWorktreePaths = (
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
      const paths = yield* Effect.forEach(targets, ({ taskId, sessions, workflow }) =>
        collectResetWorktreePaths(
          dependencies,
          repoPath,
          managedWorktreeBasePath,
          taskId,
          sessions,
          workflowRoleIds(workflow),
          "reset task",
        ),
      );
      return paths.flat();
    }
    const closeDependencies = taskWorktreeService
      ? { ...dependencies, taskWorktreeService }
      : dependencies;
    // Close returns early for a terminal task, so it removes nothing there. Remove worktree runs
    // only for a closed task, and removes the same worktrees as a close.
    const paths = yield* Effect.forEach(
      operation === "remove_worktree"
        ? targets
        : targets.filter(({ task, workflow }) => !workflow.isTerminalState(task.status)),
      ({ task, sessions, workflow }) =>
        collectCloseWorktreePaths(
          closeDependencies,
          repoPath,
          workflow,
          task,
          sessions,
          repoConfig.workspaceId,
        ),
    );
    return paths.flat();
  });

/**
 * Counts the existing task worktrees of a cleanup. A worktree that the workflow or the user
 * already removed does not count.
 */
export const countExistingWorktrees = (
  settingsConfig: Pick<SettingsConfigPort, "pathExists">,
  paths: readonly string[],
) =>
  Effect.gen(function* () {
    const existing = new Set<string>();
    for (const path of paths) {
      if (yield* settingsConfig.pathExists(path)) {
        existing.add(normalizePathForComparison(path));
      }
    }
    return existing.size;
  });
