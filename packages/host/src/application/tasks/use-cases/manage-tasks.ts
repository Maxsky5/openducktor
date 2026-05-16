import { Effect } from "effect";
import {
  validateParentRelationshipsForCreate,
  validateParentRelationshipsForUpdate,
  validateTransition,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCrudUseCases = ({
  taskStore,
}: CreateTaskServiceInput): Pick<TaskService, "createTask" | "updateTask" | "transitionTask"> => ({
  createTask(input) {
    return Effect.gen(function* () {
      const { repoPath, task } = input;
      const currentTasks = yield* taskStore.listTasks({ repoPath });
      yield* Effect.try({
        try: () => validateParentRelationshipsForCreate(currentTasks, task),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const created = yield* taskStore.createTask({ repoPath, task });

      return enrichTask(created, [...currentTasks, created]);
    });
  },

  updateTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, patch } = input;
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
      yield* Effect.try({
        try: () => validateParentRelationshipsForUpdate(currentTasks, current, patch),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const updated = yield* taskStore.updateTask({ repoPath, taskId, patch });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },

  transitionTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, status } = input;
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
      yield* Effect.try({
        try: () => validateTransition(current, currentTasks, current.status, status),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      if (current.status === status) {
        return enrichTask(current, currentTasks);
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },
});
