import { mapTaskMutationProgressErrors } from "../task-error-mapping";
import { loadTaskSessions } from "../support/task-sessions";
import { getScopedRepoConfig } from "../support/scoped-repo-config";
import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { workflowArtifactChange } from "../artifact-changes";
import {
  appendImplementationResetCleanupProgress,
  cleanupImplementationResetActivity as cleanupActivity,
  collectImplementationResetSessionState,
  collectImplementationResetTargets,
  requireImplementationResetActivityGuard as requireActivityGuard,
} from "../support/implementation-reset-targets";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
} from "../support/task-cleanup-dependencies";
import { runTaskLocalCleanup } from "../support/task-cleanup-support";
import { acquireRemovableWorktrees } from "../support/task-worktree-owner-guard";
import {
  createTaskMutationProgressFailure,
  TaskMutationProgressFailure,
} from "../task-mutation-progress-failure";
import { createTaskCleanupProgressState } from "../support/task-cleanup-progress";
import type { TaskServiceUseCaseInput } from "../task-service";
import type { HostEffectHandler } from "./host-effect-registry";

/**
 * The `worktree.reset` host effect. It stops the sessions of the worktree roles, removes their other
 * worktrees and branches, and restores the task worktree to its start point. Then it clears the
 * sessions of the worktree roles, the review artifacts, the pull request link, and the merge record.
 * A failure after the first store write reports the progress with the changed task.
 */
export const createWorktreeResetEffect = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  systemCommands,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  worktreeOwners,
  taskSessionLifecycleCoordinator: coordinator,
  completionState,
}: TaskServiceUseCaseInput): HostEffectHandler => {
  const reset: HostEffectHandler = ({ input, artifactChanges }, commit) =>
    Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* coordinator.acquireLifecycle(canonicalInputRepo, [taskId], "reset the worktree");
      const current = yield* taskStore.getTask(input);
      const workflow = taskWorkflows.forTask(current);
      const currentSessions = yield* loadTaskSessions(taskStore, input);
      const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const {
        managedWorktreeBasePath,
        canonicalWorktree,
        sessionState: canonicalSessionState,
      } = yield* collectImplementationResetSessionState(
        dependencies,
        workflow,
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
      const { worktreePaths, canonicalTarget, cleanupTargets } =
        yield* collectImplementationResetTargets(dependencies, {
          workspaceId: input.workspaceId,
          repoPath: effectiveRepoPath,
          branchPrefix: repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX,
          managedWorktreeBasePath,
          canonicalWorktree: canonicalSessionState.canonicalExists ? canonicalWorktree : null,
          task: current,
          sessions: currentSessions,
          workflow,
        });
      // The canonical worktree stays, so only the removed worktrees count.
      const removedWorktreePaths = yield* acquireRemovableWorktrees(
        { lifecycle: coordinator, worktreeOwners },
        {
          workspaceId: input.workspaceId,
          repoPath: effectiveRepoPath,
          taskId,
          operationLabel: "reset the implementation of",
          lockedPaths: worktreePaths,
          removedPaths: cleanupTargets.worktreePaths,
          confirmed: true,
        },
      );
      const cleanupProgress = createTaskCleanupProgressState();
      yield* cleanupActivity(activity, cleanupProgress);
      let taskStoreWriteCompleted = false;
      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          beforeWorktreeRemoval: {
            commands: repoConfig.hooks.beforeWorktreeRemoval,
            systemCommands,
          },
          workspaceId: input.workspaceId,
          branchNames: cleanupTargets.branchNames,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "worktree_reset",
          worktreeFiles,
          worktreePaths: removedWorktreePaths,
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
          ...input,
          repoPath: effectiveRepoPath,
          roles: [...workflow.worktreeRoles],
        });
        taskStoreWriteCompleted = true;
        cleanupProgress.completedSteps.push("Cleared the session records of the worktree roles.");
        yield* storeDependencies.clearWorkflowArtifacts({
          ...input,
          repoPath: effectiveRepoPath,
          codes: workflow.reviewArtifactCodes,
        });
        for (const code of workflow.reviewArtifactCodes)
          artifactChanges.push(workflowArtifactChange(taskId, code, true));
        cleanupProgress.completedSteps.push("Cleared the review artifacts.");
        yield* storeDependencies.setPullRequest({
          ...input,
          repoPath: effectiveRepoPath,
          pullRequest: null,
        });
        cleanupProgress.completedSteps.push("Cleared pull request metadata.");
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* storeDependencies.setDirectMerge({
              ...input,
              repoPath: effectiveRepoPath,
              directMerge: null,
            });
            cleanupProgress.completedSteps.push("Cleared direct merge metadata.");
            yield* completionState.discard({ ...input, repoPath: effectiveRepoPath });
          }),
        );
        return yield* commit;
      }).pipe(
        Effect.catch((error) => {
          // A later effect already reports its own progress.
          if (error instanceof TaskMutationProgressFailure) return Effect.fail(error);
          const decoratedFailure = appendImplementationResetCleanupProgress(error, cleanupProgress);
          const failure = taskStoreWriteCompleted
            ? createTaskMutationProgressFailure(
                "apply-task-event",
                taskId,
                decoratedFailure,
                artifactChanges,
              )
            : decoratedFailure;
          return Effect.fail(failure);
        }),
      );
    }).pipe(mapTaskMutationProgressErrors);
  return reset;
};
