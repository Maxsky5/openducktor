import type { TaskEventStatusChange } from "@openducktor/contracts";
import type { TransitionCause } from "@openducktor/workflows";
import { Context, Effect } from "effect";
import type { TaskRecord } from "./task-repository-ports";

type StatusChangeCollection = {
  changes: TaskEventStatusChange[];
  /** Runs at each commit, so the report survives a later failure or interruption. */
  committed: (change: TaskEventStatusChange, signal: string | undefined) => void;
};

// Each mutation provides its own collection. Concurrent mutations cannot share entries.
const CurrentStatusChanges = Context.Reference<StatusChangeCollection | null>(
  "@openducktor/host/CurrentTaskStatusChanges",
  { defaultValue: () => null },
);

export const collectTaskStatusChanges = <A, E, R>(
  mutation: Effect.Effect<A, E, R>,
  committed: StatusChangeCollection["committed"] = () => {},
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
  cause,
}: {
  task: TaskRecord;
  previousStatus: string;
  cause?: TransitionCause | undefined;
}): Effect.Effect<TaskRecord> =>
  Effect.gen(function* () {
    const collection = yield* CurrentStatusChanges;
    if (collection && previousStatus !== task.status) {
      const change: TaskEventStatusChange = {
        previousStatus,
        task: { id: task.id, title: task.title, status: task.status },
      };
      if (cause?.sourceRole !== undefined) change.sourceRole = cause.sourceRole;
      collection.changes.push(change);
      collection.committed(change, cause?.signal);
    }
    return task;
  });
