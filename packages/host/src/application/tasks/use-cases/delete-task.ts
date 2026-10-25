import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
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
  managedWorktreeBaseForRepoConfig,
  readTaskSessionRecords,
  runTaskBrowserTabCleanup,
  runTaskLocalCleanup,
  selectWorkflowCleanupSessionRecords,
  taskHasSessionsForRoles,
  workflowRoleIds,
} from "../support/task-cleanup-support";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskDeleteUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  browserTabs,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator,
  completionState,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "deleteTask"> => ({
  deleteTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const workflow = taskWorkflows.forRepo(repoPath);
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalInputRepo,
        [taskId],
        "delete tasks",
      );
      yield* taskStore.getTask({ repoPath, taskId });

      const targetTaskIds = [taskId];
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const targetTaskSessions = yield* readTaskSessionRecords(taskStore, repoPath, targetTaskIds);
      const hasWorkflowSessions = targetTaskSessions.some((entry) =>
        taskHasSessionsForRoles(entry.sessions, workflowRoleIds(workflow)),
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
        workflow,
        targetTaskSessions,
      );
      yield* taskSessionLifecycleCoordinator.acquireWorktreeLifecycle(worktreePaths);
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        targetTaskIds,
        worktreePaths,
        "delete",
      );
      const cleanupProgress = createTaskCleanupProgressState();
      if (hasWorkflowSessions && activityGuard) {
        const { stoppedSessionCount } = yield* activityGuard.cleanupTaskSessions({
          repoPath: effectiveRepoPath,
          taskSessions: targetTaskSessions.map(({ taskId: targetTaskId, sessions }) => ({
            taskId: targetTaskId,
            sessions: selectWorkflowCleanupSessionRecords(workflow, sessions),
          })),
        });
        recordStoppedAgentSessionCount(cleanupProgress, stoppedSessionCount);
      }
      let durableDeleteCommitted = false;
      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames,
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
        yield* runTaskBrowserTabCleanup({
          browserTabs,
          progress: cleanupProgress,
          taskIds: targetTaskIds,
          workspaceId: repoConfig.workspaceId,
        });
        const deletion = yield* Effect.result(
          taskStore.deleteTask({ repoPath: effectiveRepoPath, taskId }),
        );
        durableDeleteCommitted =
          deletion._tag === "Success" ||
          (deletion.failure instanceof TaskAssetError &&
            deletion.failure.durableState === "committed_cleanup_pending");
        if (!durableDeleteCommitted && deletion._tag === "Failure")
          return yield* Effect.fail(deletion.failure);
        const discarded = yield* Effect.forEach(targetTaskIds, (id) =>
          Effect.result(completionState.discard(effectiveRepoPath, id)),
        );
        if (deletion._tag === "Failure") return yield* Effect.fail(deletion.failure);
        for (const result of discarded)
          if (result._tag === "Failure") return yield* Effect.fail(result.failure);
        return {
          ok: true,
          changes: { taskIds: targetTaskIds, removedTaskIds: targetTaskIds },
        };
      }).pipe(
        Effect.mapError((error) =>
          durableDeleteCommitted
            ? new TaskMutationProgressFailure({
                operation: "delete-task",
                changes: { taskIds: targetTaskIds, removedTaskIds: targetTaskIds },
                failure: error,
              })
            : appendTaskCleanupProgress(error, {
                operation: "task_delete",
                removedWorktrees: cleanupProgress.removedWorktrees,
                deletedBranches: cleanupProgress.deletedBranches,
                completedSteps: cleanupProgress.completedSteps,
              }),
        ),
      );
    }).pipe(Effect.scoped);
  },
});
