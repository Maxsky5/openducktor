import { getScopedRepoConfig } from "../support/scoped-repo-config";
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
import { acquireRemovableWorktrees } from "../support/task-worktree-owner-guard";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskDeleteUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  systemCommands,
  terminalService,
  browserTabs,
  worktreeFiles,
  workspaceSettingsService,
  worktreeOwners,
  taskSessionLifecycleCoordinator,
  completionState,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "deleteTask"> => ({
  deleteTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalInputRepo,
        [taskId],
        "delete tasks",
      );
      const workflow = taskWorkflows.forTask(yield* taskStore.getTask(input));

      const targetTaskIds = [taskId];
      const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const targetTaskSessions = yield* readTaskSessionRecords(
        taskStore,
        repoPath,
        targetTaskIds,
        input.workspaceId,
      );
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
        targetTaskSessions.map((entry) => ({ ...entry, workflow })),
      );
      const checkedWorktreePaths = yield* acquireRemovableWorktrees(
        { lifecycle: taskSessionLifecycleCoordinator, worktreeOwners },
        {
          workspaceId: input.workspaceId,
          repoPath: effectiveRepoPath,
          taskId,
          operationLabel: "delete",
          lockedPaths: worktreePaths,
          confirmed: true,
        },
      );
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
          beforeWorktreeRemoval: {
            commands: repoConfig.hooks.beforeWorktreeRemoval,
            systemCommands,
          },
          workspaceId: input.workspaceId,
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
          worktreePaths: checkedWorktreePaths,
        });
        yield* runTaskBrowserTabCleanup({
          browserTabs,
          progress: cleanupProgress,
          taskIds: targetTaskIds,
          workspaceId: repoConfig.workspaceId,
        });
        const deletion = yield* Effect.result(
          taskStore.deleteTask({
            workspaceId: input.workspaceId,
            repoPath: effectiveRepoPath,
            taskId,
          }),
        );
        durableDeleteCommitted =
          deletion._tag === "Success" ||
          (deletion.failure instanceof TaskAssetError &&
            deletion.failure.durableState === "committed_cleanup_pending");
        if (!durableDeleteCommitted && deletion._tag === "Failure")
          return yield* Effect.fail(deletion.failure);
        const discarded = yield* Effect.forEach(targetTaskIds, (id) =>
          Effect.result(
            completionState.discard({
              workspaceId: input.workspaceId,
              repoPath: effectiveRepoPath,
              taskId: id,
            }),
          ),
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
