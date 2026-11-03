import type {
  AutopilotSettings,
  WorkflowReference,
  TaskArtifactChange,
  TaskChangeSet,
  TaskEventStatusChange,
} from "@openducktor/contracts";
import type { TransitionCause } from "@openducktor/workflows";
import { Context, Effect } from "effect";
import type { TaskRecord } from "./task-repository-ports";

/**
 * The workspace as the transaction of a status change read it. A status change needs `open`
 * access, so the workspace is open when the change commits.
 */
export type CommittedWorkspaceState = {
  repoPath: string;
  workspaceName: string;
};

export type TaskStatusMetadata = {
  workflowId: string;
  workflow: WorkflowReference;
  autopilotSettings: AutopilotSettings;
  workspace: CommittedWorkspaceState;
};

export type CommittedTaskMutation = TaskChangeSet & { artifactChanges: TaskArtifactChange[] };

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
  workflow,
  cause,
  ...metadata
}: TaskStatusMetadata & {
  task: TaskRecord;
  previousStatus: string;
  cause?: TransitionCause | undefined;
}): Effect.Effect<TaskRecord> =>
  Effect.gen(function* () {
    const collection = yield* CurrentStatusChanges;
    if (collection && previousStatus !== task.status) {
      const change: TaskEventStatusChange = {
        previousStatus,
        task: { id: task.id, title: task.title, status: task.status, workflow },
      };
      if (cause?.sourceRole !== undefined) change.sourceRole = cause.sourceRole;
      collection.changes.push(change);
      collection.committed(change, cause?.signal, { ...metadata, workflow });
    }
    return task;
  });

/** Record only after SQLite commits, before a pending interruption can reach the caller. */
export const recordCommittedTaskMutation = (change: CommittedTaskMutation): Effect.Effect<void> =>
  Effect.flatMap(CurrentTaskMutations, (changes) =>
    Effect.sync(() => {
      changes?.push(change);
    }),
  );

/** Publish committed writes when interruption prevents their result from reaching the caller. */
export const collectTaskMutationChanges = <A, E, R>(
  mutation: Effect.Effect<A, E, R>,
  interrupted: (
    changes: readonly CommittedTaskMutation[],
    statusChanges: readonly TaskEventStatusChange[],
  ) => Effect.Effect<void>,
) =>
  Effect.suspend(() => {
    const changes: CommittedTaskMutation[] = [];
    return mutation.pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          if (changes.length)
            yield* interrupted(changes, (yield* CurrentStatusChanges)?.changes ?? []);
        }),
      ),
      Effect.provideService(CurrentTaskMutations, changes),
    );
  });

type StatusChangeCollection = {
  changes: TaskEventStatusChange[];
  /** Runs at each commit, so the report survives a later failure or interruption. */
  committed: (
    change: TaskEventStatusChange,
    signal: string | undefined,
    metadata: TaskStatusMetadata,
  ) => void;
};

// Each mutation provides its own collection. Concurrent mutations cannot share entries.
const CurrentStatusChanges = Context.Reference<StatusChangeCollection | null>(
  "@openducktor/host/CurrentTaskStatusChanges",
  { defaultValue: () => null },
);

const CurrentTaskMutations = Context.Reference<CommittedTaskMutation[] | null>(
  "@openducktor/host/CurrentTaskMutations",
  { defaultValue: () => null },
);
