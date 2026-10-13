import type { TaskCard, TaskChangeSet, TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { validateParentRelationshipsForCreate } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceError } from "../task-service";
export const replaceEpicPlanSubtasks = (
  taskStore: TaskStorePort,
  repoPath: string,
  task: TaskCard,
  currentTasks: TaskCard[],
  subtaskCreates: TaskCreateInput[],
) =>
  Effect.gen(function* () {
    const directSubtasks = currentTasks.filter((entry) => entry.parentId === task.id);
    const removedIds: string[] = [];
    const createdIds: string[] = [];
    const replacement: Effect.Effect<void, TaskServiceError> = Effect.gen(function* () {
      for (const subtask of directSubtasks) {
        yield* taskStore.deleteTask({ repoPath, taskId: subtask.id, deleteSubtasks: false });
        removedIds.push(subtask.id);
      }
      const remainingTasks = currentTasks.filter((entry) => entry.parentId !== task.id);
      const proposalTitles = new Set<string>();
      for (const createInput of subtaskCreates) {
        const titleKey = createInput.title.trim().toLowerCase();
        if (proposalTitles.has(titleKey)) {
          continue;
        }
        proposalTitles.add(titleKey);
        const taskInput = { ...createInput, parentId: task.id };
        yield* Effect.try({
          try: () => validateParentRelationshipsForCreate(remainingTasks, taskInput),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        const created = yield* taskStore.createTask({ repoPath, task: taskInput });
        createdIds.push(created.id);
        remainingTasks.push(created);
      }
    });
    const result = yield* Effect.result(replacement);
    const changes: TaskChangeSet = {
      taskIds: [task.id, ...removedIds, ...createdIds],
      removedTaskIds: removedIds,
    };
    if (result._tag === "Success") return changes;
    if (removedIds.length === 0 && createdIds.length === 0) {
      return yield* Effect.fail(result.failure);
    }
    return yield* Effect.fail(
      new TaskMutationProgressFailure({
        operation: "set-plan",
        changes,
        failure: result.failure,
      }),
    );
  });
