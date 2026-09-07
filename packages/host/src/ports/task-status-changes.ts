import type { TaskCard, TaskEventStatusChange, TaskStatus } from "@openducktor/contracts";
import { Effect, FiberRef } from "effect";

// Each mutation owns its collection. Concurrent mutations cannot share entries.
const currentStatusChanges = FiberRef.unsafeMake<TaskEventStatusChange[] | null>(null);

export const collectTaskStatusChanges = <A, E, R>(mutation: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const statusChanges: TaskEventStatusChange[] = [];
    return Effect.either(mutation).pipe(
      Effect.map((result) => ({ result, statusChanges })),
      Effect.locally(currentStatusChanges, statusChanges),
    );
  });

// Call only after the transaction commits, while its source snapshot is still available.
export const recordCommittedTaskStatusChange = ({
  task,
  previousStatus,
}: {
  task: TaskCard;
  previousStatus: TaskStatus;
}): Effect.Effect<TaskCard> =>
  Effect.gen(function* () {
    const changes = yield* FiberRef.get(currentStatusChanges);
    if (changes && previousStatus !== task.status) {
      changes.push({
        previousStatus,
        task: { id: task.id, title: task.title, status: task.status },
      });
    }
    return task;
  });
