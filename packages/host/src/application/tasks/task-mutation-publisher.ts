import type {
  TaskChangeSet,
  TaskArtifactChange,
  TaskEventCursor,
  TaskEventStatusChange,
  WorkspaceRef,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type { TaskMutationOperation } from "./task-mutation-operation";
import type { TaskServiceError } from "./task-service";
import type { TaskSyncService } from "./sync/task-sync-service";

/** Keep the write, card projection, and receipt in one repository mutation gate. */
export const createMutationPublisher = ({
  taskSyncService,
}: {
  taskSyncService: Pick<TaskSyncService, "runStatusMutation" | "publishTasksUpdated">;
}) => {
  const runMutation = <A, B>(
    operation: TaskMutationOperation,
    workspace: WorkspaceRef,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    publishSuccess: (
      value: A,
      statusChanges: TaskEventStatusChange[],
    ) => Effect.Effect<B, TaskServiceError>,
  ): Effect.Effect<B, TaskServiceError> =>
    Effect.suspend(() =>
      taskSyncService.runStatusMutation(
        workspace,
        operation,
        mutation,
        ({ result, statusChanges }) =>
          Effect.gen(function* () {
            if (result._tag === "Failure") {
              if (result.failure instanceof TaskMutationProgressFailure) {
                yield* taskSyncService.publishTasksUpdated(
                  workspace,
                  result.failure.changes,
                  operation,
                  statusChanges,
                  result.failure.failure,
                  result.failure.artifactChanges,
                );
                return yield* Effect.fail(result.failure.failure);
              }
              return yield* Effect.fail(result.failure);
            }
            return yield* publishSuccess(result.success, statusChanges);
          }),
      ),
    );

  return {
    publish<A>(
      operation: TaskMutationOperation,
      workspace: WorkspaceRef,
      changes: TaskChangeSet,
      mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
      options: {
        changes?: (result: A) => TaskChangeSet;
        artifactChanges?: (result: A) => TaskArtifactChange[];
        onCommitted?: (() => void) | undefined;
      } = {},
    ): Effect.Effect<{ value: A; cursor: TaskEventCursor }, TaskServiceError> {
      return runMutation(operation, workspace, mutation, (value, statusChanges) => {
        options.onCommitted?.();
        return taskSyncService
          .publishTasksUpdated(
            workspace,
            options.changes?.(value) ?? changes,
            operation,
            statusChanges,
            undefined,
            options.artifactChanges?.(value),
          )
          .pipe(Effect.map((cursor) => ({ value, cursor })));
      });
    },
    publishWhen<A>(
      operation: TaskMutationOperation,
      workspace: WorkspaceRef,
      changes: TaskChangeSet,
      mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
      mutated: (value: A) => boolean,
    ): Effect.Effect<A, TaskServiceError> {
      return runMutation(operation, workspace, mutation, (value, statusChanges) =>
        mutated(value)
          ? taskSyncService
              .publishTasksUpdated(workspace, changes, operation, statusChanges)
              .pipe(Effect.as(value))
          : Effect.succeed(value),
      );
    },
  };
};
