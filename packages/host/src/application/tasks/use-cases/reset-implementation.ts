import { DEFAULT_BRANCH_PREFIX, type TaskArtifactChange } from "@openducktor/contracts";
import { Effect } from "effect";
import { workflowArtifactChange } from "../artifact-changes";
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
  runTaskLocalCleanup,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import {
  requireEffectInput,
  resultingStatus,
  transitionCause,
} from "../support/task-workflow-events";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { createTaskCleanupProgressState } from "../support/task-cleanup-progress";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";

export const createTaskImplementationResetUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator: coordinator,
  completionState,
}: TaskServiceUseCaseInput) => ({
  resetImplementation(input: Parameters<TaskService["resetImplementation"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* coordinator.acquireLifecycle(canonicalInputRepo, [taskId], "reset implementation");
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forRepo(repoPath);
      const decision = yield* requireEffectInput(
        "Implementation reset is",
        workflow,
        "implementation.reset",
        current,
        { repoPath, taskId, status: current.status },
      );
      const { agentSessions: currentSessions } = yield* taskStore.getTaskMetadata(input);
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
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
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        current.id,
        currentSessions,
        new Set(workflow.worktreeRoles),
        "reset implementation",
      );
      const relatedBranches = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
        worktreePaths,
        "reset implementation",
      );
      const canonicalTarget = canonicalSessionState.canonicalExists
        ? yield* resolveCanonicalImplementationResetTarget(
            dependencies.gitPort,
            dependencies.workspaceSettingsService,
            current,
            effectiveRepoPath,
            canonicalWorktree,
            branchPrefix,
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
      const artifactChanges: TaskArtifactChange[] = [];
      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames: cleanupTargets.branchNames,
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
          roles: [...workflow.worktreeRoles],
        });
        taskStoreWriteCompleted = true;
        cleanupProgress.completedSteps.push("Cleared the session records of the worktree roles.");
        yield* storeDependencies.clearWorkflowArtifacts({
          repoPath: effectiveRepoPath,
          taskId,
          codes: workflow.reviewArtifactCodes,
        });
        for (const code of workflow.reviewArtifactCodes)
          artifactChanges.push(workflowArtifactChange(taskId, code, true));
        cleanupProgress.completedSteps.push("Cleared the review artifacts.");
        yield* storeDependencies.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        cleanupProgress.completedSteps.push("Cleared pull request metadata.");
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* storeDependencies.setDirectMerge({
              repoPath: effectiveRepoPath,
              taskId,
              directMerge: null,
            });
            cleanupProgress.completedSteps.push("Cleared direct merge metadata.");
            yield* completionState.discard(effectiveRepoPath, taskId);
          }),
        );
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: resultingStatus(decision),
          cause: transitionCause(decision),
        });
        return enrichTask(workflow, updated);
      }).pipe(
        Effect.catch((error) => {
          const decoratedFailure = appendImplementationResetCleanupProgress(error, cleanupProgress);
          const failure = taskStoreWriteCompleted
            ? createTaskMutationProgressFailure(
                "reset-implementation",
                taskId,
                decoratedFailure,
                artifactChanges,
              )
            : decoratedFailure;
          return Effect.fail(failure);
        }),
      );
    }).pipe(Effect.scoped);
  },
});
