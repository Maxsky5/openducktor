import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  appendDeleteCleanupProgress,
  collectDeleteWorktreePaths,
  collectRelatedTaskBranches,
  collectTaskDeleteTargets,
  managedWorktreeBaseForRepoConfig,
  type TaskSessionRecords,
  taskHasImplementationSessions,
} from "../support/reset-cleanup";
import {
  requireTaskDeleteDependencies,
  requireTaskWorktreeCleanupFiles,
} from "../support/task-reset-dependencies";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskDeleteUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  worktreeFiles,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "deleteTask"> => ({
  deleteTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, deleteSubtasks } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          workspaceSettingsService,
        ),
      );
      const currentTasks = yield* taskStore.listTasks({ repoPath });
      const current = currentTasks.find((task) => task.id === taskId);
      if (!current) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task not found: ${taskId}`,
            details: { repoPath, taskId },
          }),
        );
      }

      const directSubtaskIds = currentTasks
        .filter((task) => task.parentId === taskId)
        .map((task) => task.id);
      if (directSubtaskIds.length > 0 && !deleteSubtasks) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "deleteSubtasks",
            message: `Task ${taskId} has ${directSubtaskIds.length} subtasks. Confirm subtask deletion to continue.`,
            details: { repoPath, taskId, directSubtaskIds },
          }),
        );
      }

      const targetTasks = collectTaskDeleteTargets(currentTasks, taskId, deleteSubtasks);
      const targetTaskIds = targetTasks.map((task) => task.id);
      const targetTaskSessions: TaskSessionRecords[] = [];
      for (const targetTask of targetTasks) {
        const metadata = yield* taskStore.getTaskMetadata({
          repoPath,
          taskId: targetTask.id,
        });
        targetTaskSessions.push({
          taskId: targetTask.id,
          sessions: metadata.agentSessions,
        });
      }
      if (targetTaskSessions.some((entry) => taskHasImplementationSessions(entry.sessions))) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_delete",
              message:
                "task_delete requires runtime session activity checks for tasks with build or QA sessions.",
              details: { repoPath, taskId },
            }),
          );
        }
        yield* taskActivityGuard.ensureNoActiveTaskDeleteRuns({
          repoPath,
          taskSessions: targetTaskSessions,
        });
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectDeleteWorktreePaths(
        dependencies,
        effectiveRepoPath,
        branchPrefix,
        targetTaskSessions,
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        targetTaskIds,
      );
      const removedWorktrees: string[] = [];
      const deletedBranches: string[] = [];

      return yield* Effect.gen(function* () {
        for (const targetTaskId of targetTaskIds) {
          yield* dependencies.devServerService.stop({
            repoPath: effectiveRepoPath,
            taskId: targetTaskId,
          });
        }
        for (const worktreePath of worktreePaths) {
          yield* removeWorktreeAndFilesystemPath(
            {
              gitPort: dependencies.gitPort,
              settingsConfig: dependencies.settingsConfig,
              worktreeFiles: requireTaskWorktreeCleanupFiles(worktreeFiles, "task_delete"),
            },
            {
              repoPath: effectiveRepoPath,
              worktreePath,
              force: true,
              managedWorktreeBasePath,
              missingOutsideManagedRootPathPolicy: "skip",
            },
          );
          removedWorktrees.push(worktreePath);
        }
        for (const branchName of branchNames) {
          yield* dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
          deletedBranches.push(branchName);
        }
        yield* taskStore.deleteTask({
          repoPath: effectiveRepoPath,
          taskId,
          deleteSubtasks,
        });

        return { ok: true };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(appendDeleteCleanupProgress(error, removedWorktrees, deletedBranches)),
        ),
      );
    });
  },
});
