import {
  type ExternalTaskSyncEvent,
  type TaskDocumentChange,
  type TaskEventCursor,
  externalTaskSyncEventSchema,
  type TaskCard,
  type TaskChangeSet,
  type TaskEventTaskSnapshot,
  type TaskEventStatusChange,
} from "@openducktor/contracts";
import { type Cause, Deferred, Effect, Exit, Ref, type Result } from "effect";
import { createSerialGate } from "../../../effect/serial-gate";
import { HostOperationError, type HostOperationErrorAggregate } from "../../../effect/host-errors";
import type { TaskEventStreamPort } from "../../../events/task-event-stream";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import { collectTaskStatusChanges } from "../../../ports/task-status-changes";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  CommittedTaskStatusChangeObserver,
  TaskMutationOperation,
} from "../task-mutation-operation";
import type { RepoPullRequestSyncResult, TaskService, TaskServiceError } from "../task-service";

const DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export type TaskSyncLifecycleLogger = {
  error(message: string): Effect.Effect<void, unknown>;
};
export type TaskSyncLoopHandle = {
  /**
   * Stop scheduling work without waiting for an active pull-request sync, while draining any
   * lifecycle log append admitted before shutdown.
   */
  stop(): Effect.Effect<void, HostOperationError>;
};
export type TaskSyncService = {
  runMutation<A, E, R>(repoPath: string, mutation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  /**
   * Runs a task mutation in the repository mutation gate. It reports each status change when it
   * commits, so a later failure or interruption keeps the report. `afterCommit` runs next in the
   * same gate turn.
   */
  runStatusMutation<A, E, R, B, E2, R2>(
    repoPath: string,
    operation: TaskMutationOperation,
    mutation: Effect.Effect<A, E, R>,
    afterCommit: (committed: {
      result: Result.Result<A, E>;
      statusChanges: TaskEventStatusChange[];
    }) => Effect.Effect<B, E2, R2>,
  ): Effect.Effect<B, E2, R | R2>;
  publishExternalTaskCreated(
    repoPath: string,
    taskSnapshot: TaskEventTaskSnapshot,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  publishTasksUpdated(
    repoPath: string,
    changes: TaskChangeSet,
    operation: TaskMutationOperation,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
    documentChanges?: TaskDocumentChange[],
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate>;
  syncRepoPullRequests(
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
  /**
   * A workspace failure must not block other workspaces. A failed log write stops the run.
   */
  syncOpenWorkspacePullRequests(): Effect.Effect<void, TaskSyncError>;
  startPullRequestSyncLoop(): Effect.Effect<TaskSyncLoopHandle, never>;
};
export type TaskSyncError = HostOperationError | TaskServiceError | WorkspaceSettingsError;
type TaskEventPublicationFailureBase = {
  operation: string;
  repoPath: string;
  changes: TaskChangeSet;
  cause: unknown;
};
export type TaskEventPublicationFailure =
  | (TaskEventPublicationFailureBase & {
      stage: "acceptance";
      event: ExternalTaskSyncEvent;
    })
  | (TaskEventPublicationFailureBase & { stage: "snapshot" });
export type TaskEventPublicationReporter = {
  report(failure: TaskEventPublicationFailure): Effect.Effect<void, never>;
};
export type CreateTaskSyncServiceInput = {
  eventIdFactory?: () => string;
  acceptNotificationInput?: ((event: ExternalTaskSyncEvent) => void) | undefined;
  observeStatusChanges?: CommittedTaskStatusChangeObserver | undefined;
  intervalMs?: number;
  logger?: TaskSyncLifecycleLogger;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
  publicationReporter: TaskEventPublicationReporter;
  taskEventStream: TaskEventStreamPort;
  taskService: Pick<TaskService, "listTasks" | "repoPullRequestSyncDetailed">;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "listWorkspaces" | "getSettingsSnapshot"
  >;
};
const defaultTaskSyncLifecycleLogger: TaskSyncLifecycleLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
};
type TaskSyncLoopState = {
  activeLog: Deferred.Deferred<void, HostOperationError> | null;
  stopped: boolean;
  terminalLogCause: Cause.Cause<HostOperationError> | null;
};
const nowIso = (): string => new Date().toISOString();
const buildExternalTaskCreatedEvent = (
  eventIdFactory: () => string,
  repoPath: string,
  taskSnapshot: TaskEventTaskSnapshot,
): ExternalTaskSyncEvent => ({
  eventId: eventIdFactory(),
  kind: "external_task_created",
  repoPath,
  taskId: taskSnapshot.id,
  taskSnapshot: { id: taskSnapshot.id, title: taskSnapshot.title, status: taskSnapshot.status },
  boardChanges: null,
  emittedAt: nowIso(),
});
const buildTasksUpdatedEvent = (
  eventIdFactory: () => string,
  repoPath: string,
  changes: TaskChangeSet,
  taskSnapshots: readonly TaskEventTaskSnapshot[],
  statusChanges: readonly TaskEventStatusChange[],
  operation: string,
): Extract<ExternalTaskSyncEvent, { kind: "tasks_updated" }> => ({
  eventId: eventIdFactory(),
  kind: "tasks_updated",
  repoPath,
  ...changes,
  taskSnapshots: [...taskSnapshots],
  statusChanges: statusChanges.map((change) => {
    if (change.task.status === "human_review" && operation === "build-completed") {
      return { ...change, sourceRole: "build" };
    }
    if (change.task.status === "human_review" && operation === "qa-approved") {
      return { ...change, sourceRole: "qa" };
    }
    return change;
  }),
  boardChanges: null,
  emittedAt: nowIso(),
});
const taskSnapshotsForChanges = (
  tasks: readonly TaskCard[],
  changes: TaskChangeSet,
): TaskEventTaskSnapshot[] => {
  const changedTaskIds = new Set(changes.taskIds);
  const removedTaskIds = new Set(changes.removedTaskIds);
  return tasks
    .filter((task) => changedTaskIds.has(task.id) && !removedTaskIds.has(task.id))
    .map(({ id, title, status }) => ({ id, title, status }));
};
export const createTaskSyncService = ({
  eventIdFactory = () => crypto.randomUUID(),
  acceptNotificationInput,
  observeStatusChanges,
  intervalMs = DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS,
  logger = defaultTaskSyncLifecycleLogger,
  onBackgroundFailure,
  publicationReporter,
  taskEventStream,
  taskService,
  workspaceSettingsService,
}: CreateTaskSyncServiceInput): TaskSyncService => {
  // Mutations of one repository run in arrival order.
  const mutationGate = createSerialGate();
  const runMutation: TaskSyncService["runMutation"] = (repoPath, mutation) =>
    mutationGate.run(repoPath, mutation);
  const runStatusMutation: TaskSyncService["runStatusMutation"] = (
    repoPath,
    operation,
    mutation,
    afterCommit,
  ) =>
    runMutation(
      repoPath,
      collectTaskStatusChanges(mutation, (statusChange) =>
        observeStatusChanges?.({ repoPath, operation, statusChange }),
      ).pipe(Effect.flatMap(afterCommit)),
    );
  const publish = (
    event: ExternalTaskSyncEvent,
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutationFailure?: TaskServiceError,
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const eventValidation = externalTaskSyncEventSchema.safeParse(event);
      const result = yield* Effect.result(
        eventValidation.success
          ? Effect.try({ try: () => taskEventStream.publish(event), catch: (cause) => cause })
          : Effect.fail(eventValidation.error),
      );
      if (result._tag === "Failure") {
        yield* publicationReporter.report({
          operation,
          repoPath,
          changes,
          event,
          stage: "acceptance",
          cause: result.failure,
        });
        const recoveryMessage =
          "Task changes were saved, but their update event could not be sent. Reload the workspace before continuing. Do not repeat the change.";
        return yield* new HostOperationError({
          operation: `${operation}.publish-task-update`,
          message: mutationFailure
            ? `${mutationFailure.message} ${recoveryMessage}`
            : recoveryMessage,
          cause: mutationFailure
            ? { mutationFailure, publicationFailure: result.failure }
            : result.failure,
          details: { durableState: "committed", stage: "acceptance", repoPath, changes },
        });
      }
      return result.success;
    });
  const readBoardChanges = (repoPath: string, taskIds: string[]) =>
    Effect.gen(function* () {
      const settings = yield* workspaceSettingsService.getSettingsSnapshot();
      const doneVisibleDays = settings.kanban.doneVisibleDays;
      const cards = yield* taskService.listTasks({ repoPath, taskIds, doneVisibleDays });
      return { cards, doneVisibleDays, documentChanges: [] };
    });
  const publishExternalTaskCreated = (repoPath: string, taskSnapshot: TaskEventTaskSnapshot) =>
    Effect.gen(function* () {
      const event = buildExternalTaskCreatedEvent(eventIdFactory, repoPath, taskSnapshot);
      acceptNotificationInput?.(event);
      const changes = { taskIds: [taskSnapshot.id], removedTaskIds: [] };
      const result = yield* Effect.result(readBoardChanges(repoPath, changes.taskIds));
      if (result._tag === "Failure") {
        yield* publicationReporter.report({
          operation: "create-task",
          repoPath,
          changes,
          stage: "snapshot",
          cause: result.failure,
        });
        return yield* new HostOperationError({
          operation: "create-task.publish-task-update",
          message:
            "Task was created, but its update event could not be sent. Reload the workspace before continuing. Do not repeat the change.",
          cause: result.failure,
          details: { durableState: "committed", stage: "snapshot", repoPath, changes },
        });
      }
      yield* publish({ ...event, boardChanges: result.success }, "create-task", repoPath, changes);
    });
  const publishTasksUpdated = (
    repoPath: string,
    changes: TaskChangeSet,
    operation: TaskMutationOperation,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
    documentChanges: TaskDocumentChange[] = [],
  ): Effect.Effect<TaskEventCursor, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const event = buildTasksUpdatedEvent(
        eventIdFactory,
        repoPath,
        changes,
        [],
        statusChanges,
        operation,
      );
      acceptNotificationInput?.(event);
      if (operation.startsWith("agent-session-") && statusChanges.length === 0) {
        return yield* publish(event, operation, repoPath, changes, mutationFailure);
      }
      const tasks = yield* Effect.result(
        readBoardChanges(
          repoPath,
          changes.taskIds.filter((id) => !changes.removedTaskIds.includes(id)),
        ),
      );
      if (tasks._tag === "Failure") {
        yield* publicationReporter.report({
          operation,
          repoPath,
          changes,
          stage: "snapshot",
          cause: tasks.failure,
        });
        const recoveryMessage =
          "Task changes were saved, but their update event could not be sent. Reload the workspace before continuing. Do not repeat the change.";
        return yield* new HostOperationError({
          operation: `${operation}.publish-task-update`,
          message: mutationFailure
            ? `${mutationFailure.message} ${recoveryMessage}`
            : recoveryMessage,
          cause: mutationFailure
            ? { mutationFailure, snapshotFailure: tasks.failure }
            : tasks.failure,
          details: { durableState: "committed", stage: "snapshot", repoPath, changes },
        });
      }
      const taskSnapshots = taskSnapshotsForChanges(tasks.success.cards, changes);
      acceptNotificationInput?.({ ...event, taskSnapshots });
      return yield* publish(
        { ...event, taskSnapshots, boardChanges: { ...tasks.success, documentChanges } },
        operation,
        repoPath,
        changes,
        mutationFailure,
      );
    });
  const syncRepoPullRequests = (
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError> =>
    runStatusMutation(
      repoPath,
      "repo-pull-request-sync",
      taskService.repoPullRequestSyncDetailed({ repoPath }),
      ({ result: syncResult, statusChanges }) =>
        Effect.gen(function* () {
          if (syncResult._tag === "Success") {
            const changes = { taskIds: syncResult.success.changedTaskIds, removedTaskIds: [] };
            if (changes.taskIds.length > 0) {
              yield* publishTasksUpdated(
                repoPath,
                changes,
                "repo-pull-request-sync",
                statusChanges,
              );
            }
            return syncResult.success;
          }
          if (syncResult.failure instanceof TaskMutationProgressFailure) {
            yield* publishTasksUpdated(
              repoPath,
              syncResult.failure.changes,
              syncResult.failure.operation,
              statusChanges,
              syncResult.failure.failure,
              syncResult.failure.documentChanges,
            );
            return yield* Effect.fail(syncResult.failure.failure);
          }
          return yield* Effect.fail(syncResult.failure);
        }),
    );
  const syncOpenWorkspacePullRequests = (
    onFailure = logSyncFailure,
  ): Effect.Effect<void, TaskSyncError> =>
    Effect.gen(function* () {
      const workspaces = yield* Effect.result(workspaceSettingsService.listWorkspaces());
      if (workspaces._tag === "Failure") {
        return yield* onFailure(workspaces.failure);
      }
      for (const workspace of workspaces.success) {
        yield* syncRepoPullRequests(workspace.repoPath).pipe(
          Effect.catch((error) => onFailure(error, workspace.repoPath)),
        );
      }
    });
  const runSyncLoop = (state: Ref.Ref<TaskSyncLoopState>) =>
    Effect.forever(
      syncOpenWorkspacePullRequests((error, repoPath) =>
        logLoopFailure(state, error, repoPath),
      ).pipe(Effect.andThen(Effect.sleep(`${intervalMs} millis`))),
    );
  // Finish logs that start before shutdown so stop() can report a write failure.
  const logLoopFailure = (
    state: Ref.Ref<TaskSyncLoopState>,
    error: TaskSyncError,
    repoPath?: string,
  ): Effect.Effect<void, HostOperationError> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const completion = yield* Deferred.make<void, HostOperationError>();
        const canLog = yield* Ref.modify(state, (current) => {
          if (current.stopped) {
            return [false, current];
          }
          return [true, { ...current, activeLog: completion }];
        });
        if (!canLog) {
          return;
        }

        const exit = yield* Effect.exit(logSyncFailure(error, repoPath));
        yield* Ref.update(state, (current) => ({
          ...current,
          activeLog: null,
          terminalLogCause: Exit.isFailure(exit) ? exit.cause : null,
        }));
        yield* Deferred.done(completion, exit);
        if (Exit.isFailure(exit)) {
          return yield* Effect.failCause(exit.cause);
        }
      }),
    );
  const logSyncFailure = (
    error: TaskSyncError,
    repoPath?: string,
  ): Effect.Effect<void, HostOperationError> => {
    const message = error instanceof Error ? error.message : String(error);
    const detail = repoPath ? `${repoPath}: ${message}` : message;
    return logger
      .error(
        `Pull request sync iteration failed; the scheduler will retry on the next interval: ${detail}`,
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "task-sync.log-iteration-failure",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        ),
        Effect.tapError(onBackgroundFailure),
      );
  };
  return {
    runMutation,
    runStatusMutation,
    publishExternalTaskCreated,
    publishTasksUpdated,
    syncRepoPullRequests,
    syncOpenWorkspacePullRequests,
    startPullRequestSyncLoop() {
      return Effect.gen(function* () {
        const state = yield* Ref.make<TaskSyncLoopState>({
          activeLog: null,
          stopped: false,
          terminalLogCause: null,
        });
        const fiber = yield* Effect.forkDetach(runSyncLoop(state));
        return {
          stop: () =>
            Effect.gen(function* () {
              const shutdown = yield* Ref.modify(state, (current) => [
                {
                  activeLog: current.activeLog,
                  terminalLogCause: current.terminalLogCause,
                },
                { ...current, stopped: true },
              ]);
              // Do not wait for an in-flight sync iteration. Only its failure log must finish.
              yield* Effect.sync(() => fiber.interruptUnsafe());
              if (shutdown.activeLog) {
                return yield* Deferred.await(shutdown.activeLog);
              }
              if (shutdown.terminalLogCause) {
                return yield* Effect.failCause(shutdown.terminalLogCause);
              }
            }),
        };
      });
    },
  };
};
