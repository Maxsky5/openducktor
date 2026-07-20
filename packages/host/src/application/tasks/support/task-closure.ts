import type { TaskCard } from "@openducktor/contracts";
import { Effect, type Scope } from "effect";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";

type TaskClosureStore = Pick<TaskStorePort, "transitionTask">;

export const completeTaskClosure = <CleanupError>({
  cleanup,
  repoPath,
  taskId,
  taskStore,
}: {
  cleanup: Effect.Effect<void, CleanupError, Scope.Scope>;
  repoPath: string;
  taskId: string;
  taskStore: TaskClosureStore;
}): Effect.Effect<TaskCard, CleanupError | TaskStoreError> =>
  Effect.scoped(
    cleanup.pipe(
      Effect.zipRight(
        Effect.suspend(() => taskStore.transitionTask({ repoPath, taskId, status: "closed" })),
      ),
    ),
  );
