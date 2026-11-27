import {
  planBackgroundSteps,
  backgroundStep,
} from "../../operation-progress/background-operation-progress";
import { loadTaskSessions } from "../support/task-sessions";
import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import { Effect } from "effect";
import { collectRelatedTaskBranches } from "../support/task-branch-tips";
import { removedArtifactChanges } from "../artifact-changes";
import { HostDependencyError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import { requireTaskDeleteDependencies } from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  clearTaskResetDelivery,
  createTaskCleanupProgressState,
  stopTaskSessionsWithProgress,
} from "../support/task-cleanup-progress";
import { managedWorktreeBaseForRepoConfig } from "../../git/managed-worktree-roots";
import {
  collectResetWorktreePaths,
  runTaskLocalCleanup,
  taskCleanupRoles,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import { acquireRemovableWorktrees } from "../support/task-worktree-owner-guard";
import { requireNoUnpublishedDirectMerge } from "../support/direct-merge-block";
import { coreTaskTransition, decideCoreTaskAction } from "../support/task-workflow-events";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";
export const createTaskFullResetUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard: activityGuard,
  settingsConfig,
  systemCommands,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  worktreeOwners,
  taskSessionLifecycleCoordinator,
  completionState,
}: TaskServiceUseCaseInput) => ({
  resetTask(input: Parameters<TaskService["resetTask"]>[0]) {
    return Effect.gen(function* () {
      yield* planBackgroundSteps(
        { id: "terminals", label: "Stop task terminals" },
        { id: "artifacts", label: "Clear task artifacts" },
        { id: "session-records", label: "Remove task session links" },
        { id: "pull-request", label: "Clear pull request link" },
        { id: "direct-merge", label: "Clear merge record" },
        { id: "delivery", label: "Clear merge and push progress" },
        { id: "task-reset", label: "Reset task status" },
      );
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
      const current = yield* taskStore.getTask(input);
      const workflow = taskWorkflows.forTask(current);
      // A reset of an open task keeps the status and still clears the task.
      yield* Effect.fromResult(decideCoreTaskAction("reset", current));
      yield* requireNoUnpublishedDirectMerge(taskStore, input, current.status);
      const currentSessions = yield* loadTaskSessions(taskStore, input);
      const workflowRoles = taskCleanupRoles(workflow, currentSessions);
      const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const taskRef = { workspaceId: input.workspaceId, repoPath: effectiveRepoPath, taskId };
      const hasWorkflowSessions = currentSessions.length > 0;
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
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        current.id,
        currentSessions,
        workflowRoles,
        "reset task",
      );
      const checkedWorktreePaths = yield* acquireRemovableWorktrees(
        { lifecycle: taskSessionLifecycleCoordinator, worktreeOwners },
        {
          ...taskRef,
          operationLabel: "reset",
          lockedPaths: worktreePaths,
          confirmed: true,
        },
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies,
        repoConfig,
        effectiveRepoPath,
        current,
        worktreePaths,
        "reset task",
      );
      const cleanupProgress = createTaskCleanupProgressState();
      if (hasWorkflowSessions && activityGuard) {
        yield* stopTaskSessionsWithProgress(
          cleanupProgress,
          activityGuard.cleanupTaskSessions({
            workspaceId: input.workspaceId,
            repoPath: effectiveRepoPath,
            taskSessions: [
              {
                taskId,
                sessions: currentSessions,
              },
            ],
          }),
        );
      }
      let taskStoreWriteCompleted = false;
      const artifactIds = (yield* taskStore.listArtifacts(input)).map(
        (artifact) => artifact.artifactId,
      );
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
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_reset",
          worktreeFiles,
          worktreePaths: checkedWorktreePaths,
        });
        yield* backgroundStep(
          { id: "artifacts", label: "Clear task artifacts" },
          taskStore.clearTaskArtifacts(taskRef),
        );
        taskStoreWriteCompleted = true;
        cleanupProgress.completedSteps.push("cleared task artifacts");
        yield* backgroundStep(
          { id: "session-records", label: "Remove task session links" },
          taskStore.clearAgentSessionsByRoles({ ...taskRef, roles: [...workflowRoles] }),
        );
        cleanupProgress.completedSteps.push("cleared linked agent sessions");
        yield* clearTaskResetDelivery(taskStore, completionState, taskRef, cleanupProgress);
        const updated = yield* backgroundStep(
          { id: "task-reset", label: "Reset task status" },
          taskStore.transitionTask({
            ...taskRef,
            decide: coreTaskTransition(taskWorkflows, "reset"),
          }),
        );
        return { task: enrichTask(workflow, updated), removedArtifactIds: artifactIds };
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
