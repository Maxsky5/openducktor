import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { TaskAssetError } from "../../../effect/task-asset-error";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import {
  validateParentRelationshipsForCreateEffect,
  validateParentRelationshipsForUpdateEffect,
  validateTaskTransitionEffect,
} from "../support/task-validation-effects";
import { enrichTask } from "../support/task-workflow-helpers";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  CreateTaskServiceInput,
  TaskService,
  TaskServiceWithMutationProgress,
} from "../task-service";

const preserveCommittedAssetMutation = (
  operation: "create-task" | "update-task",
  taskId: string | undefined,
  error: TaskStoreError,
) => {
  if (
    error instanceof TaskAssetError &&
    error.durableState === "committed_cleanup_pending" &&
    taskId
  ) {
    return new TaskMutationProgressFailure({
      operation,
      changes: { taskIds: [taskId], removedTaskIds: [] },
      failure: error,
    });
  }
  return error;
};

export const createTaskCrudUseCases = ({
  taskStore,
}: CreateTaskServiceInput): Pick<TaskServiceWithMutationProgress, "createTask" | "updateTask"> &
  Pick<TaskService, "transitionTask"> => ({
  createTask(input) {
    return Effect.gen(function* () {
      const { repoPath, task, descriptionAssets } = input;
      const parentId = task.parentId?.trim() || undefined;
      const normalizedTask = { ...task, parentId };
      const needsParentValidation = Boolean(parentId);
      const currentTasks = needsParentValidation ? yield* taskStore.listTasks({ repoPath }) : [];
      if (needsParentValidation) {
        yield* validateParentRelationshipsForCreateEffect(currentTasks, normalizedTask);
      }
      const created = yield* taskStore
        .createTask({
          repoPath,
          task: normalizedTask,
          ...(descriptionAssets ? { descriptionAssets } : {}),
        })
        .pipe(
          Effect.mapError((error) =>
            preserveCommittedAssetMutation(
              "create-task",
              error instanceof TaskAssetError ? error.taskId : undefined,
              error,
            ),
          ),
        );

      return enrichTask(created, [...currentTasks, created]);
    });
  },

  updateTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, patch, descriptionAssets } = input;
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
      yield* validateParentRelationshipsForUpdateEffect(currentTasks, current, patch);
      const updated = yield* taskStore
        .updateTask({
          repoPath,
          taskId,
          patch,
          ...(descriptionAssets ? { descriptionAssets } : {}),
        })
        .pipe(
          Effect.mapError((error) => preserveCommittedAssetMutation("update-task", taskId, error)),
        );
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },

  transitionTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, status } = input;
      if (status === "closed") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "status",
            message:
              "task_transition cannot close tasks. Use task_close or an explicit delivery completion command.",
            details: { repoPath, taskId, status },
          }),
        );
      }
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
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, status);

      if (current.status === status) {
        return enrichTask(current, currentTasks);
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },
});
