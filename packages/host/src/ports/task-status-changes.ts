import type { TaskCard, TaskEventStatusChange, TaskStatus } from "@openducktor/contracts";
import { Context, Effect } from "effect";

// Each mutation provides its own collection. Concurrent mutations cannot share entries.
const CurrentStatusChanges = Context.Reference<TaskEventStatusChange[] | null>(
  "@openducktor/host/CurrentTaskStatusChanges",
  { defaultValue: () => null },
);

export const collectTaskStatusChanges = <A, E, R>(mutation: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const statusChanges: TaskEventStatusChange[] = [];
    return Effect.result(mutation).pipe(
      Effect.map((result) => ({ result, statusChanges })),
      Effect.provideService(CurrentStatusChanges, statusChanges),
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
    const changes = yield* CurrentStatusChanges;
    if (changes && previousStatus !== task.status) {
      changes.push({
        previousStatus,
        task: { id: task.id, title: task.title, status: task.status },
      });
    }
    return task;
  });
