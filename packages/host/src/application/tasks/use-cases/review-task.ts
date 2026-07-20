import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  createTaskCleanupProgressState,
  runTaskRuntimeCleanup,
} from "../support/task-cleanup-support";
import { completeTaskClosure } from "../support/task-closure";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, recordQaOutcome, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskReviewUseCases = ({
  devServerService,
  gitPort,
  taskStore,
  taskSessionBootstrapCoordinator,
  terminalService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "qaApproved" | "qaRejected" | "humanRequestChanges" | "humanApprove"
> => ({
  qaApproved(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;

      return yield* recordQaOutcome(taskStore, {
        repoPath,
        taskId,
        markdown,
        verdict: "approved",
        targetStatus: "human_review",
      });
    });
  },

  qaRejected(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;

      return yield* recordQaOutcome(taskStore, {
        repoPath,
        taskId,
        markdown,
        verdict: "rejected",
        targetStatus: "in_progress",
      });
    });
  },

  humanRequestChanges(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      if (metadata.directMerge !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot request changes after a local direct merge has already been applied for task ${taskId}. Push and complete the direct merge workflow first, or manually revert the local merge before reopening the task.`,
            details: { repoPath, taskId },
          }),
        );
      }

      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* validateTaskTransitionEffect(current, [current], current.status, "in_progress");

      if (current.status === "in_progress") {
        return enrichTask(current, [current]);
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
      return enrichTask(updated, [updated]);
    });
  },

  humanApprove(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");

      if (current.status === "closed") {
        return enrichTask(current, currentTasks);
      }

      if (!devServerService) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "task dependency",
            message: "Dev server service is required for human_approve.",
          }),
        );
      }
      if (!terminalService) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "task dependency",
            message: "Terminal service is required for human_approve.",
          }),
        );
      }
      const updated = yield* completeTaskClosure({
        cleanup: runTaskRuntimeCleanup({
          devServerService,
          progress: createTaskCleanupProgressState(),
          repoPath,
          taskIds: [taskId],
          terminalService,
        }),
        gitPort,
        operation: "approve task",
        repoPath,
        taskId,
        taskSessionBootstrapCoordinator,
        taskStore,
      });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },
});
