import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { TaskAssetError } from "../../../effect/task-asset-error";
import { requireDependencies } from "../support/required-task-dependencies";
import { requireTaskDeleteDependencies } from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  createTaskCleanupProgressState,
  recordStoppedAgentSessionCount,
} from "../support/task-cleanup-progress";
import {
  collectDeleteWorktreePaths,
  collectRelatedTaskBranches,
  collectTaskDeleteTargets,
  managedWorktreeBaseForRepoConfig,
  runTaskLocalCleanup,
  selectWorkflowCleanupSessionRecords,
  type TaskSessionRecords,
  taskHasSessionsForRoles,
  workflowCleanupSessionRoles,
} from "../support/task-cleanup-support";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskDeleteUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "deleteTask"> => ({
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
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalInputRepo,
        [taskId],
        "delete tasks",
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
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const additionalTaskIds = targetTaskIds.filter((targetTaskId) => targetTaskId !== taskId);
      if (additionalTaskIds.length > 0) {
        yield* taskSessionLifecycleCoordinator.acquireLifecycle(
          canonicalInputRepo,
          additionalTaskIds,
          "delete tasks",
        );
      }
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
      const hasWorkflowSessions = targetTaskSessions.some((entry) =>
        taskHasSessionsForRoles(entry.sessions, workflowCleanupSessionRoles),
      );
      const activityGuard = taskActivityGuard;
      if (hasWorkflowSessions && !activityGuard) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "taskActivityGuard",
            operation: "task_delete",
            message:
              "task_delete requires runtime session activity checks for tasks with workflow sessions.",
            details: { repoPath, taskId },
          }),
        );
      }
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectDeleteWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        branchPrefix,
        targetTaskSessions,
      );
      yield* taskSessionLifecycleCoordinator.acquireWorktreeLifecycle(worktreePaths);
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        targetTaskIds,
      );
      const cleanupProgress = createTaskCleanupProgressState();
      if (hasWorkflowSessions && activityGuard) {
        const { stoppedSessionCount } = yield* activityGuard.cleanupTaskSessions({
          repoPath: effectiveRepoPath,
          taskSessions: targetTaskSessions.map(({ taskId: targetTaskId, sessions }) => ({
            taskId: targetTaskId,
            sessions: selectWorkflowCleanupSessionRecords(sessions),
          })),
        });
        recordStoppedAgentSessionCount(cleanupProgress, stoppedSessionCount);
      }

      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames,
          devServerService: dependencies.devServerService,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: targetTaskIds,
          terminalService,
          worktreeCleanupOperation: "task_delete",
          worktreeFiles,
          worktreePaths,
        });
        yield* taskStore.deleteTask({
          repoPath: effectiveRepoPath,
          taskId,
          deleteSubtasks,
        });

        return {
          ok: true,
          changes: { taskIds: targetTaskIds, removedTaskIds: targetTaskIds },
        };
      }).pipe(
        Effect.catchAll((error) => {
          const failure = appendTaskCleanupProgress(error, {
            operation: "task_delete",
            removedWorktrees: cleanupProgress.removedWorktrees,
            deletedBranches: cleanupProgress.deletedBranches,
            completedSteps: cleanupProgress.completedSteps,
          });
          const result =
            error instanceof TaskAssetError && error.durableState === "committed_cleanup_pending"
              ? new TaskMutationProgressFailure({
                  operation: "delete-task",
                  changes: { taskIds: targetTaskIds, removedTaskIds: targetTaskIds },
                  failure,
                })
              : failure;
          return Effect.fail(result);
        }),
      );
    }).pipe(Effect.scoped);
  },
});
