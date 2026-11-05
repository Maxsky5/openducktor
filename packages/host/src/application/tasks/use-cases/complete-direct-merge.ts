import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  requireDependencies,
  requireMergedTaskCleanupDependencies,
} from "../support/required-task-dependencies";
import { enrichTask } from "../support/task-workflow-helpers";
import { closeMergedTask } from "../support/close-merged-task";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  taskWorkflows,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  systemCommands,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
  worktreeFiles,
  worktreeOwners,
  completionState,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "completeDirectMerge"> => ({
  completeDirectMerge(input) {
    return Effect.gen(function* () {
      const { taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireMergedTaskCleanupDependencies(
          {
            gitPort,
            settingsConfig,
            systemCommands,
            taskWorktreeService,
            terminalService,
            workspaceSettingsService,
            worktreeFiles,
          },
          "task_direct_merge_complete",
        ),
      );
      const repoPath = yield* dependencies.gitPort.canonicalizePath(input.repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        repoPath,
        [taskId],
        "complete direct merge",
      );
      const current = yield* taskStore.getTask({ ...input, repoPath });
      const metadata = yield* taskStore.getTaskMetadata({ ...input, repoPath });
      const merge = metadata.directMerge;
      if (!merge)
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} does not have a locally applied direct merge to complete.`,
          details: { repoPath, taskId },
        });
      const state = completionState.ensure({ workspaceId: input.workspaceId, repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      // A completed publication closes the task. A closed task stays closed.
      if (current.status === TASK_CLOSED_STATE) {
        delete state.observation.failure;
        state.observation.taskClosed = true;
        state.observation.phase = "settled";
        yield* completionState.publish(state);
        return enrichTask(workflow, current);
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
      return yield* closeMergedTask(
        {
          ...dependencies,
          taskStore,
          completionState,
          taskActivityGuard,
          taskSessionLifecycleCoordinator,
          worktreeOwners,
          workflow,
          taskWorkflows,
        },
        { ...input, repoPath },
        merge,
        current,
        state,
        "complete-direct-merge",
      );
    }).pipe(Effect.scoped);
  },
});
