import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  requireDependencies,
  requireMergedTaskCleanupDependencies,
} from "../support/required-task-dependencies";
import { requireEffectEvent, taskEventPolicyError } from "../support/task-workflow-events";
import { enrichTask } from "../support/task-workflow-helpers";
import { closeMergedTask } from "../support/close-merged-task";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  taskWorkflows,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
  worktreeFiles,
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
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const merge = metadata.directMerge;
      if (!merge)
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} does not have a locally applied direct merge to complete.`,
          details: { repoPath, taskId },
        });
      const state = completionState.ensure(repoPath, taskId);
      const workflow = taskWorkflows.forTask(current);
      const completeEvent = yield* requireEffectEvent(workflow, "direct_merge.completed");
      const decision = workflow.decide(completeEvent, current);
      if (decision.kind === "unchanged") {
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
      if (decision.kind === "denied") {
        return yield* taskEventPolicyError(completeEvent, current, decision);
      }
      return yield* closeMergedTask(
        {
          ...dependencies,
          taskStore,
          completionState,
          taskActivityGuard,
          taskSessionLifecycleCoordinator,
          workflow,
        },
        { ...input, repoPath },
        merge,
        current,
        state,
        decision,
        "complete-direct-merge",
      );
    }).pipe(Effect.scoped);
  },
});
