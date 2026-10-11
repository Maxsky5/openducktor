import type { TaskCard, TaskEventStatusChange, TaskStatus } from "@openducktor/contracts";
import { Context, Effect } from "effect";

type StatusChangeCollection = {
  changes: TaskEventStatusChange[];
  /** Runs at each commit, so the report survives a later failure or interruption. */
  committed: (change: TaskEventStatusChange) => void;
};

// Each mutation provides its own collection. Concurrent mutations cannot share entries.
const CurrentStatusChanges = Context.Reference<StatusChangeCollection | null>(
  "@openducktor/host/CurrentTaskStatusChanges",
  { defaultValue: () => null },
);

export const collectTaskStatusChanges = <A, E, R>(
  mutation: Effect.Effect<A, E, R>,
  committed: (change: TaskEventStatusChange) => void = () => {},
) =>
  Effect.suspend(() => {
    const statusChanges: TaskEventStatusChange[] = [];
    return Effect.result(mutation).pipe(
      Effect.map((result) => ({ result, statusChanges })),
      Effect.provideService(CurrentStatusChanges, { changes: statusChanges, committed }),
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
    const collection = yield* CurrentStatusChanges;
    if (collection && previousStatus !== task.status) {
      const change = {
        previousStatus,
        task: { id: task.id, title: task.title, status: task.status },
      };
      collection.changes.push(change);
      collection.committed(change);
    }
    return task;
  });
