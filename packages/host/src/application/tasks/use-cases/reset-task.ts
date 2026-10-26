import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { removedArtifactChanges } from "../artifact-changes";
import { HostDependencyError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import { requireTaskDeleteDependencies } from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  createTaskCleanupProgressState,
  recordStoppedAgentSessionCount,
} from "../support/task-cleanup-progress";
import {
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  managedWorktreeBaseForRepoConfig,
  runTaskLocalCleanup,
  selectWorkflowCleanupSessionRecords,
  taskHasSessionsForRoles,
  workflowRoleIds,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import {
  requireEffectInput,
  resultingStatus,
  transitionCause,
} from "../support/task-workflow-events";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";

export const createTaskFullResetUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard: activityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator,
  completionState,
}: TaskServiceUseCaseInput) => ({
  resetTask(input: Parameters<TaskService["resetTask"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalInputRepo,
        [taskId],
        "reset task",
      );
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      const workflowRoles = workflowRoleIds(workflow);
      // A reset from the initial state keeps the status and still clears the task.
      const decision = yield* requireEffectInput("Task reset is", workflow, "task.reset", current, {
        repoPath,
        taskId,
        status: current.status,
      });
      const { agentSessions: currentSessions } = yield* taskStore.getTaskMetadata(input);
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const hasWorkflowSessions = taskHasSessionsForRoles(currentSessions, workflowRoles);
      if (hasWorkflowSessions && !activityGuard) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "taskActivityGuard",
            operation: "task_reset",
            message:
              "task_reset requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
            details: { repoPath, taskId },
          }),
        );
      }
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        current.id,
        currentSessions,
        workflowRoles,
        "reset task",
      );
      yield* taskSessionLifecycleCoordinator.acquireWorktreeLifecycle(worktreePaths);
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
        worktreePaths,
        "reset task",
      );
      const cleanupProgress = createTaskCleanupProgressState();
      if (hasWorkflowSessions && activityGuard) {
        const { stoppedSessionCount } = yield* activityGuard.cleanupTaskSessions({
          repoPath: effectiveRepoPath,
          taskSessions: [
            {
              taskId,
              sessions: selectWorkflowCleanupSessionRecords(workflow, currentSessions),
            },
          ],
        });
        recordStoppedAgentSessionCount(cleanupProgress, stoppedSessionCount);
      }

      let taskStoreWriteCompleted = false;
      const artifactIds = (yield* taskStore.listArtifacts(input)).map(
        (artifact) => artifact.artifactId,
      );

      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_reset",
          worktreeFiles,
          worktreePaths,
        });
        yield* taskStore.clearTaskArtifacts({ repoPath: effectiveRepoPath, taskId });
        taskStoreWriteCompleted = true;
        cleanupProgress.completedSteps.push("cleared task artifacts");
        yield* taskStore.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...workflowRoles],
        });
        cleanupProgress.completedSteps.push("cleared linked agent sessions");
        yield* taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* taskStore.setDirectMerge({
              repoPath: effectiveRepoPath,
              taskId,
              directMerge: null,
            });
            cleanupProgress.completedSteps.push("cleared linked delivery metadata");
            yield* completionState.discard(effectiveRepoPath, taskId);
          }),
        );
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: resultingStatus(decision),
          cause: transitionCause(decision),
        });
        const task = enrichTask(workflow, updated);
        return { task, removedArtifactIds: artifactIds };
      }).pipe(
        Effect.catch((error) => {
          const decoratedFailure = appendTaskCleanupProgress(error, {
            operation: "task_reset",
            removedWorktrees: cleanupProgress.removedWorktrees,
            deletedBranches: cleanupProgress.deletedBranches,
            completedSteps: cleanupProgress.completedSteps,
          });
          const failure = taskStoreWriteCompleted
            ? createTaskMutationProgressFailure(
                "reset-task",
                taskId,
                decoratedFailure,
                removedArtifactChanges(taskId, artifactIds),
              )
            : decoratedFailure;
          return Effect.fail(failure);
        }),
      );
    }).pipe(Effect.scoped);
  },
});
