import type {
  TaskChangeSet,
  TaskArtifactChange,
  TaskEventCursor,
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
  const publish = <A>(
    operation: TaskMutationOperation,
    workspace: WorkspaceRef,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    options: {
      changes?: (result: A) => TaskChangeSet;
      artifactChanges?: (result: A) => TaskArtifactChange[];
    } = {},
  ): Effect.Effect<{ value: A; cursor: TaskEventCursor }, TaskServiceError> =>
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
            const cursor = yield* taskSyncService.publishTasksUpdated(
              workspace,
              options.changes?.(result.success) ?? changes,
              operation,
              statusChanges,
              undefined,
              options.artifactChanges?.(result.success),
            );
            return { value: result.success, cursor };
          }),
      ),
    );

  return publish;
};
