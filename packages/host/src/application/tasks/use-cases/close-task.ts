import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireTaskCloseDependencies,
  requireTaskCloseWorktreeService,
} from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  collectRelatedTaskBranches,
  createTaskCleanupProgressState,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  runTaskLocalCleanup,
  taskHasSessionsForRoles,
  workflowCleanupSessionRoleNames,
  workflowCleanupSessionRoles,
} from "../support/task-cleanup-support";
import { collectCloseWorktreePaths } from "../support/task-close-cleanup";
import { completeTaskClosure } from "../support/task-closure";
import { validateManualCloseTaskEffect } from "../support/task-validation-effects";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCloseUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  taskWorktreeService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionBootstrapCoordinator,
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

      const dependencies = yield* requireDependencies(() =>
        requireTaskCloseDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          workspaceSettingsService,
        ),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const cleanupProgress = createTaskCleanupProgressState();
      const cleanup = Effect.gen(function* () {
        const currentMetadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
        const currentSessions = currentMetadata.agentSessions;
        const hasWorkflowSessions = taskHasSessionsForRoles(
          currentSessions,
          workflowCleanupSessionRoles,
        );
        if (hasWorkflowSessions && !taskActivityGuard) {
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
        if (hasWorkflowSessions && taskActivityGuard) {
          yield* taskActivityGuard.ensureNoActiveTaskResetActivity({
            repoPath: effectiveRepoPath,
            taskId,
            sessions: currentSessions,
            operationLabel: "close task",
            sessionRoles: [...workflowCleanupSessionRoleNames],
          });
        }

        const taskWorktreePath = dependencies.settingsConfig.join(managedWorktreeBasePath, taskId);
        const taskWorktreePathExists =
          yield* dependencies.settingsConfig.pathExists(taskWorktreePath);
        let taskWorktreeDependency = taskWorktreeService;
        if (!taskWorktreeDependency && taskWorktreePathExists) {
          taskWorktreeDependency = yield* requireDependencies(() =>
            requireTaskCloseWorktreeService(taskWorktreeService),
          );
        }
        const closeWorktreeDependencies = taskWorktreeDependency
          ? { ...dependencies, taskWorktreeService: taskWorktreeDependency }
          : dependencies;
        const worktreePaths = yield* collectCloseWorktreePaths(
          closeWorktreeDependencies,
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
        yield* runTaskLocalCleanup({
          branchNames,
          devServerService: dependencies.devServerService,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_close",
          worktreeFiles,
          worktreePaths,
        });
      });

      return yield* Effect.gen(function* () {
        const updated = yield* completeTaskClosure({
          cleanup,
          gitPort: dependencies.gitPort,
          operation: "close task",
          repoPath: effectiveRepoPath,
          taskId,
          taskSessionBootstrapCoordinator,
          taskStore,
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_close",
              removedWorktrees: cleanupProgress.removedWorktrees,
              deletedBranches: cleanupProgress.deletedBranches,
              completedSteps: cleanupProgress.completedSteps,
            }),
          ),
        ),
      );
    }).pipe(Effect.scoped);
  },
});
