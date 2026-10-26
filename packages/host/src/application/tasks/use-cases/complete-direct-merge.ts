import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  requireDependencies,
  requireMergedTaskCleanupDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import { closeMergedTask } from "../support/close-merged-task";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  completionState,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "completeDirectMerge"> => ({
  completeDirectMerge(input) {
    return Effect.gen(function* () {
      const { taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireMergedTaskCleanupDependencies(
          { gitPort, settingsConfig, taskWorktreeService, terminalService, worktreeFiles },
          "task_direct_merge_complete",
        ),
      );
      const repoPath = yield* dependencies.gitPort.canonicalizePath(input.repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        repoPath,
        [taskId],
        "complete direct merge",
      );
      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const merge = metadata.directMerge;
      if (!merge)
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} does not have a locally applied direct merge to complete.`,
          details: { repoPath, taskId },
        });
      const state = completionState.ensure(repoPath, taskId);
      if (current.status === "closed") {
        delete state.observation.failure;
        state.observation.taskClosed = true;
        state.observation.phase = "settled";
        yield* completionState.publish(state);
        return enrichTask(current, currentTasks);
      }
      if (metadata.agentSessions.length) {
        if (!taskActivityGuard)
          return yield* new HostDependencyError({
            dependency: "taskActivityGuard",
            operation: "complete direct merge",
            message:
              "Task activity guard is required to check sessions before completing direct merge.",
          });
        const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
          repoPath,
          taskSessions: [{ taskId, sessions: metadata.agentSessions }],
        });
        if (liveSessionCount)
          return yield* new HostValidationError({
            field: "taskId",
            message: `Stop all running sessions for task ${taskId} before completing direct merge.`,
            details: { repoPath, taskId },
          });
      }
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
      return yield* closeMergedTask(
        {
          ...dependencies,
          taskStore,
          completionState,
          taskActivityGuard,
          taskSessionLifecycleCoordinator,
        },
        { ...input, repoPath },
        merge,
        currentTasks,
        state,
        "complete-direct-merge",
      );
    }).pipe(Effect.scoped);
  },
});
