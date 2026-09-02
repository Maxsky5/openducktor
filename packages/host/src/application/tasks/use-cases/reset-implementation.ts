import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { canResetImplementationFromStatus } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import {
  appendImplementationResetCleanupProgress,
  cleanupImplementationResetActivity as cleanupActivity,
  collectImplementationResetSessionState,
  excludeCanonicalImplementationTargets,
  requireImplementationResetActivityGuard as requireActivityGuard,
  resolveCanonicalImplementationResetTarget,
} from "../support/implementation-reset-targets";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
} from "../support/task-cleanup-dependencies";
import {
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  implementationSessionRoleNames,
  replaceTaskInList,
  resetImplementationRollbackStatus,
  runTaskLocalCleanup,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { createTaskCleanupProgressState } from "../support/task-cleanup-progress";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";
export const createTaskImplementationResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionBootstrapCoordinator: coordinator,
}: TaskServiceUseCaseInput) => ({
  resetImplementation(input: Parameters<TaskService["resetImplementation"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          workspaceSettingsService,
        ),
      );
      const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* coordinator.acquireLifecycle(canonicalInputRepo, [taskId], "reset implementation");
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
      if (!canResetImplementationFromStatus(current.status)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
            details: { repoPath, taskId, status: current.status },
          }),
        );
      }
      const currentSessions = (yield* taskStore.getTaskMetadata({ repoPath, taskId }))
        .agentSessions;
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const {
        managedWorktreeBasePath,
        canonicalWorktree,
        sessionState: canonicalSessionState,
      } = yield* collectImplementationResetSessionState(
        dependencies,
        repoConfig,
        taskId,
        currentSessions,
      );
      const activity = {
        taskActivityGuard,
        repoPath: effectiveRepoPath,
        taskId,
        sessions: canonicalSessionState.guarded,
      };
      yield* requireActivityGuard(activity);
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        branchPrefix,
        current.id,
        currentSessions,
        new Set<string>(implementationSessionRoleNames),
        "reset implementation",
      );
      const relatedBranches = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const canonicalTarget = canonicalSessionState.canonicalExists
        ? yield* resolveCanonicalImplementationResetTarget(
            dependencies.gitPort,
            dependencies.workspaceSettingsService,
            current,
            effectiveRepoPath,
            canonicalWorktree,
          )
        : null;
      const cleanupTargets = excludeCanonicalImplementationTargets(
        worktreePaths,
        relatedBranches,
        canonicalTarget,
      );
      yield* coordinator.acquireWorktreeLifecycle(worktreePaths);
      const cleanupProgress = createTaskCleanupProgressState();
      yield* cleanupActivity(activity, cleanupProgress);
      let taskStoreWriteCompleted = false;
      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames: cleanupTargets.branchNames,
          devServerService: dependencies.devServerService,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_reset_implementation",
          worktreeFiles,
          worktreePaths: cleanupTargets.worktreePaths,
        });
        if (canonicalTarget) {
          yield* dependencies.gitPort.restoreWorktreeToReference(
            canonicalTarget.worktreePath,
            canonicalTarget.restoreReference,
          );
          cleanupProgress.completedSteps.push(
            `Restored canonical worktree ${canonicalWorktree} to ${canonicalTarget.restoreReference}.`,
          );
        }
        yield* storeDependencies.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...implementationSessionRoleNames],
        });
        taskStoreWriteCompleted = true;
        cleanupProgress.completedSteps.push("Cleared Builder and QA session records.");
        yield* storeDependencies.clearQaReports({ repoPath: effectiveRepoPath, taskId });
        cleanupProgress.completedSteps.push("Cleared QA reports.");
        yield* storeDependencies.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        cleanupProgress.completedSteps.push("Cleared pull request metadata.");
        yield* storeDependencies.setDirectMerge({
          repoPath: effectiveRepoPath,
          taskId,
          directMerge: null,
        });
        cleanupProgress.completedSteps.push("Cleared direct merge metadata.");
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: resetImplementationRollbackStatus(current),
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) => {
          const decoratedFailure = appendImplementationResetCleanupProgress(error, cleanupProgress);
          const failure = taskStoreWriteCompleted
            ? createTaskMutationProgressFailure("reset-implementation", taskId, decoratedFailure)
            : decoratedFailure;
          return Effect.fail(failure);
        }),
      );
    }).pipe(Effect.scoped);
  },
});
