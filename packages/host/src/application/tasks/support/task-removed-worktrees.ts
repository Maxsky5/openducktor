import type {
  AgentSessionRecord,
  RepoConfig,
  TaskStopImpactOperation,
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

export type RemovedWorktreeOperation = Exclude<TaskStopImpactOperation, "reset_implementation">;

export type RemovedWorktreeTarget = {
  task: TaskRecord;
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
  workflow: TaskWorkflow,
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
        workflow,
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
          workflowRoleIds(workflow),
          "reset task",
        ),
      );
      return paths.flat();
    }
    const closeDependencies = taskWorktreeService
      ? { ...dependencies, taskWorktreeService }
      : dependencies;
    // Close returns early for a terminal task, so it removes nothing there.
    const paths = yield* Effect.forEach(
      targets.filter(({ task }) => !workflow.isTerminalState(task.status)),
      ({ task, sessions }) =>
        collectCloseWorktreePaths(closeDependencies, repoPath, workflow, task, sessions),
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
  workflow: TaskWorkflow,
  repoConfig: RepoConfig,
  repoPath: string,
  targets: RemovedWorktreeTarget[],
) =>
  Effect.gen(function* () {
    const paths = yield* collectRemovedWorktreePaths(
      dependencies,
      operation,
      workflow,
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
