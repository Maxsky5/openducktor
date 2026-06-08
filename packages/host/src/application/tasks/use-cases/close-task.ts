import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  appendTaskCleanupProgress,
  collectRelatedTaskBranches,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  taskHasSessionsForRoles,
  taskResetSessionRoleNames,
  taskResetSessionRoles,
} from "../support/task-cleanup-support";
import { collectCloseWorktreePaths } from "../support/task-close-cleanup";
import {
  requireTaskCloseDependencies,
  requireTaskWorktreeCleanupFiles,
} from "../support/task-reset-dependencies";
import { validateManualCloseTaskEffect } from "../support/task-validation-effects";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCloseUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  taskWorktreeService,
  worktreeFiles,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "closeTask"> => ({
  closeTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
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
      if (current.status === "closed") {
        return enrichTask(current, currentTasks);
      }

      yield* validateManualCloseTaskEffect(current, currentTasks);

      const currentMetadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const currentSessions = currentMetadata.agentSessions;

      if (taskHasSessionsForRoles(currentSessions, taskResetSessionRoles)) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_close",
              message:
                "task_close requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
              details: { repoPath, taskId },
            }),
          );
        }
        yield* taskActivityGuard.ensureNoActiveTaskResetActivity({
          repoPath,
          taskId,
          sessions: currentSessions,
          operationLabel: "close task",
          sessionRoles: [...taskResetSessionRoleNames],
        });
      }

      const dependencies = yield* requireDependencies(() =>
        requireTaskCloseDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
          workspaceSettingsService,
        ),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectCloseWorktreePaths(
        dependencies,
        effectiveRepoPath,
        branchPrefix,
        current,
        currentSessions,
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const cleanupFiles =
        worktreePaths.length > 0
          ? yield* requireDependencies(() =>
              requireTaskWorktreeCleanupFiles(worktreeFiles, "task_close"),
            )
          : null;
      const removedWorktrees: string[] = [];
      const deletedBranches: string[] = [];
      const completedSteps: string[] = [];

      return yield* Effect.gen(function* () {
        yield* dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
        completedSteps.push("stopped task dev servers");
        if (cleanupFiles) {
          for (const worktreePath of worktreePaths) {
            yield* removeWorktreeAndFilesystemPath(
              {
                gitPort: dependencies.gitPort,
                settingsConfig: dependencies.settingsConfig,
                worktreeFiles: cleanupFiles,
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
        }
        for (const branchName of branchNames) {
          yield* dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
          deletedBranches.push(branchName);
        }
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: "closed",
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_close",
              label: "Close",
              retryVerb: "close",
              removedWorktrees,
              deletedBranches,
              completedSteps,
            }),
          ),
        ),
      );
    });
  },
});
