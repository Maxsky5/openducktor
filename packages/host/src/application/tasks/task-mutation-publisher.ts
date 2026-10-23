import type { TaskChangeSet, TaskArtifactChange, TaskEventCursor } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type { TaskMutationOperation } from "./task-mutation-operation";
import type { TaskService, TaskServiceError } from "./task-service";
import type { TaskSyncService } from "./sync/task-sync-service";

/** Keep the write, card projection, and receipt in one repository mutation gate. */
export const createMutationPublisher = ({
  taskSyncService,
  listTasks,
}: {
  taskSyncService: Pick<TaskSyncService, "runStatusMutation" | "publishTasksUpdated">;
  listTasks: TaskService["listTasks"];
}) => {
  const publish = <A>(
    operation: TaskMutationOperation,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    options: {
      settleOnInterrupt?: boolean;
      changes?: (result: A) => TaskChangeSet;
      previousParentTaskIds?: string[];
      artifactChanges?: (result: A) => TaskArtifactChange[];
    } = {},
  ): Effect.Effect<{ value: A; cursor: TaskEventCursor }, TaskServiceError> =>
    Effect.suspend(() => {
      const previousParentTaskIds = options.previousParentTaskIds ?? [];
      let oldParents: string[] = [];
      const includeOldParents = (next: TaskChangeSet): TaskChangeSet => ({
        ...next,
        taskIds: [...new Set([...next.taskIds, ...oldParents])],
      });
      return taskSyncService.runStatusMutation(
        repoPath,
        operation,
        Effect.gen(function* () {
          if (previousParentTaskIds.length > 0) {
            oldParents = (yield* listTasks({
              repoPath,
              taskIds: previousParentTaskIds,
            }))
              .filter((task) => previousParentTaskIds.includes(task.id))
              .flatMap((task) => (task.parentId ? [task.parentId] : []));
          }
          return yield* mutation;
        }),
        ({ result, statusChanges }) =>
          Effect.gen(function* () {
            if (result._tag === "Failure") {
              if (result.failure instanceof TaskMutationProgressFailure) {
                yield* taskSyncService.publishTasksUpdated(
                  repoPath,
                  includeOldParents(result.failure.changes),
                  operation,
                  statusChanges,
                  result.failure.failure,
                  result.failure.artifactChanges,
                );
                return yield* Effect.fail(result.failure.failure);
              }
              return yield* Effect.fail(result.failure);
            }
            const cursor = yield* taskSyncService.publishTasksUpdated(
              repoPath,
              includeOldParents(options.changes?.(result.success) ?? changes),
              operation,
              statusChanges,
              undefined,
              options.artifactChanges?.(result.success),
            );
            return { value: result.success, cursor };
          }),
        options.settleOnInterrupt,
      );
    });

  return publish;
};
