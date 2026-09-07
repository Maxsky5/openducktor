import {
  type ExternalTaskSyncEvent,
  externalTaskSyncEventSchema,
  type TaskCard,
  type TaskChangeSet,
  type TaskEventTaskSnapshot,
  type TaskEventStatusChange,
} from "@openducktor/contracts";
import { type Cause, Deferred, Effect, Exit, Fiber, Ref } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../../effect/host-errors";
import type { TaskEventStreamPort } from "../../../events/task-event-stream";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import { collectTaskStatusChanges } from "../../../ports/task-status-changes";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
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
  publishExternalTaskCreated(
    repoPath: string,
    taskSnapshot: TaskEventTaskSnapshot,
  ): Effect.Effect<void>;
  publishTasksUpdated(
    repoPath: string,
    changes: TaskChangeSet,
    operation: string,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  syncRepoPullRequests(
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
  syncActiveWorkspacePullRequests(): Effect.Effect<void, TaskSyncError>;
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
  intervalMs?: number;
  logger?: TaskSyncLifecycleLogger;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
  publicationReporter: TaskEventPublicationReporter;
  taskEventStream: TaskEventStreamPort;
  taskService: Pick<TaskService, "listTasks" | "repoPullRequestSyncDetailed">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "listWorkspaces">;
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
  emittedAt: nowIso(),
});
const buildTasksUpdatedEvent = (
  eventIdFactory: () => string,
  repoPath: string,
  changes: TaskChangeSet,
  taskSnapshots: readonly TaskEventTaskSnapshot[],
  statusChanges: readonly TaskEventStatusChange[],
  operation: string,
): ExternalTaskSyncEvent => ({
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
  intervalMs = DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS,
  logger = defaultTaskSyncLifecycleLogger,
  onBackgroundFailure,
  publicationReporter,
  taskEventStream,
  taskService,
  workspaceSettingsService,
}: CreateTaskSyncServiceInput): TaskSyncService => {
  const mutationGates = new Map<string, Effect.Semaphore>();
  const runMutation: TaskSyncService["runMutation"] = (repoPath, mutation) =>
    Effect.suspend(() => {
      let gate = mutationGates.get(repoPath);
      if (!gate) {
        gate = Effect.runSync(Effect.makeSemaphore(1));
        mutationGates.set(repoPath, gate);
      }
      return gate.withPermits(1)(mutation);
    });
  const publish = (
    event: ExternalTaskSyncEvent,
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const eventValidation = externalTaskSyncEventSchema.safeParse(event);
      if (!eventValidation.success) {
        yield* publicationReporter.report({
          operation,
          repoPath,
          changes,
          event,
          stage: "acceptance",
          cause: eventValidation.error,
        });
        return;
      }
      const result = yield* Effect.either(
        Effect.try({
          try: () => taskEventStream.publish(event),
          catch: (cause) => cause,
        }),
      );
      if (result._tag === "Left") {
        yield* publicationReporter.report({
          operation,
          repoPath,
          changes,
          event,
          stage: "acceptance",
          cause: result.left,
        });
      }
    });
  const publishExternalTaskCreated = (repoPath: string, taskSnapshot: TaskEventTaskSnapshot) =>
    publish(
      buildExternalTaskCreatedEvent(eventIdFactory, repoPath, taskSnapshot),
      "create-task",
      repoPath,
      { taskIds: [taskSnapshot.id], removedTaskIds: [] },
    );
  const publishTasksUpdated = (
    repoPath: string,
    changes: TaskChangeSet,
    operation: string,
    statusChanges: readonly TaskEventStatusChange[],
    mutationFailure?: TaskServiceError,
  ): Effect.Effect<void, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const tasks = yield* Effect.either(taskService.listTasks({ repoPath }));
      if (tasks._tag === "Left") {
        yield* publicationReporter.report({
          operation,
          repoPath,
          changes,
          stage: "snapshot",
          cause: tasks.left,
        });
        const recoveryMessage =
          "Task changes were saved, but their update event could not be sent. Reload the workspace before continuing. Do not repeat the change.";
        return yield* new HostOperationError({
          operation: `${operation}.publish-task-update`,
          message: mutationFailure
            ? `${mutationFailure.message} ${recoveryMessage}`
            : recoveryMessage,
          cause: mutationFailure ? { mutationFailure, snapshotFailure: tasks.left } : tasks.left,
          details: { durableState: "committed", stage: "snapshot", repoPath, changes },
        });
      }
      const taskSnapshots = taskSnapshotsForChanges(tasks.right, changes);
      yield* publish(
        buildTasksUpdatedEvent(
          eventIdFactory,
          repoPath,
          changes,
          taskSnapshots,
          statusChanges,
          operation,
        ),
        operation,
        repoPath,
        changes,
      );
    });
  const syncRepoPullRequests = (
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError> =>
    Effect.gen(function* () {
      const { result: syncResult, statusChanges } = yield* collectTaskStatusChanges(
        taskService.repoPullRequestSyncDetailed({ repoPath }),
      );
      if (syncResult._tag === "Right") {
        const changes = { taskIds: syncResult.right.changedTaskIds, removedTaskIds: [] };
        if (changes.taskIds.length > 0) {
          yield* publishTasksUpdated(repoPath, changes, "repo-pull-request-sync", statusChanges);
        }
        return syncResult.right;
      }
      if (syncResult.left instanceof TaskMutationProgressFailure) {
        yield* publishTasksUpdated(
          repoPath,
          syncResult.left.changes,
          syncResult.left.operation,
          statusChanges,
          syncResult.left.failure,
        );
        return yield* Effect.fail(syncResult.left.failure);
      }
      return yield* Effect.fail(syncResult.left);
    }).pipe((mutation) => runMutation(repoPath, mutation));
  const syncActiveWorkspacePullRequests = (): Effect.Effect<void, TaskSyncError> =>
    Effect.gen(function* () {
      const activeWorkspace = (yield* workspaceSettingsService.listWorkspaces()).find(
        (workspace) => workspace.isActive,
      );
      if (!activeWorkspace) {
        return;
      }
      yield* syncRepoPullRequests(activeWorkspace.repoPath);
    });
  const writePullRequestSyncIterationFailure = (
    state: Ref.Ref<TaskSyncLoopState>,
    error: TaskSyncError,
  ): Effect.Effect<void, HostOperationError> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const completion = yield* Deferred.make<void, HostOperationError>();
        const admitted = yield* Ref.modify(state, (current) => {
          if (current.stopped) {
            return [false, current];
          }
          return [true, { ...current, activeLog: completion }];
        });
        if (!admitted) {
          return;
        }

        const ownedLogExit = yield* Effect.exit(
          logger
            .error(
              `Pull request sync iteration failed; the scheduler will retry on the next interval: ${error instanceof Error ? error.message : String(error)}`,
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
            ),
        );
        yield* Ref.update(state, (current) => ({
          ...current,
          activeLog: null,
          terminalLogCause: Exit.isFailure(ownedLogExit) ? ownedLogExit.cause : null,
        }));
        yield* Deferred.done(completion, ownedLogExit);
        if (Exit.isFailure(ownedLogExit)) {
          return yield* Effect.failCause(ownedLogExit.cause);
        }
      }),
    );
  const runPullRequestSyncLoopIteration = (state: Ref.Ref<TaskSyncLoopState>) =>
    syncActiveWorkspacePullRequests().pipe(
      Effect.catchAll((error) => writePullRequestSyncIterationFailure(state, error)),
    );
  const runPullRequestSyncLoop = (state: Ref.Ref<TaskSyncLoopState>) =>
    Effect.forever(
      Effect.sleep(`${intervalMs} millis`).pipe(
        Effect.zipRight(runPullRequestSyncLoopIteration(state)),
      ),
    );
  return {
    runMutation,
    publishExternalTaskCreated,
    publishTasksUpdated,
    syncRepoPullRequests,
    syncActiveWorkspacePullRequests,
    startPullRequestSyncLoop() {
      return Effect.gen(function* () {
        const state = yield* Ref.make<TaskSyncLoopState>({
          activeLog: null,
          stopped: false,
          terminalLogCause: null,
        });
        const fiber = yield* Effect.forkDaemon(runPullRequestSyncLoop(state));
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
              yield* Fiber.interruptFork(fiber);
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
