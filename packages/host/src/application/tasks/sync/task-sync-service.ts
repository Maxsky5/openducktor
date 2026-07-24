import {
  type ExternalTaskSyncEvent,
  externalTaskSyncEventSchema,
  type TaskChangeSet,
} from "@openducktor/contracts";
import { type Cause, Deferred, Effect, Exit, Fiber, Ref } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskEventStreamPort } from "../../../events/task-event-stream";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
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
  publishExternalTaskCreated(repoPath: string, taskId: string): Effect.Effect<void>;
  publishTasksUpdated(
    repoPath: string,
    changes: TaskChangeSet,
    operation: string,
  ): Effect.Effect<void>;
  syncRepoPullRequests(
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
  syncActiveWorkspacePullRequests(): Effect.Effect<void, TaskSyncError>;
  startPullRequestSyncLoop(): Effect.Effect<TaskSyncLoopHandle, never>;
};
export type TaskSyncError = HostOperationError | TaskServiceError | WorkspaceSettingsError;
export type TaskEventPublicationFailure = {
  operation: string;
  repoPath: string;
  changes: TaskChangeSet;
  event: ExternalTaskSyncEvent;
  stage: "acceptance";
  cause: unknown;
};
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
  taskService: Pick<TaskService, "repoPullRequestSyncDetailed">;
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
  taskId: string,
): ExternalTaskSyncEvent => ({
  eventId: eventIdFactory(),
  kind: "external_task_created",
  repoPath,
  taskId,
  emittedAt: nowIso(),
});
const buildTasksUpdatedEvent = (
  eventIdFactory: () => string,
  repoPath: string,
  changes: TaskChangeSet,
): ExternalTaskSyncEvent => ({
  eventId: eventIdFactory(),
  kind: "tasks_updated",
  repoPath,
  ...changes,
  emittedAt: nowIso(),
});
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
  const publishExternalTaskCreated = (repoPath: string, taskId: string) =>
    publish(
      buildExternalTaskCreatedEvent(eventIdFactory, repoPath, taskId),
      "create-task",
      repoPath,
      { taskIds: [taskId], removedTaskIds: [] },
    );
  const publishTasksUpdated = (repoPath: string, changes: TaskChangeSet, operation: string) => {
    return publish(
      buildTasksUpdatedEvent(eventIdFactory, repoPath, changes),
      operation,
      repoPath,
      changes,
    );
  };
  const syncRepoPullRequests = (
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError> =>
    Effect.gen(function* () {
      const syncResult = yield* Effect.either(
        taskService.repoPullRequestSyncDetailed({ repoPath }),
      );
      if (syncResult._tag === "Right") {
        const changes = { taskIds: syncResult.right.changedTaskIds, removedTaskIds: [] };
        if (changes.taskIds.length > 0) {
          yield* publishTasksUpdated(repoPath, changes, "repo-pull-request-sync");
        }
        return syncResult.right;
      }
      if (syncResult.left instanceof TaskMutationProgressFailure) {
        yield* publishTasksUpdated(repoPath, syncResult.left.changes, syncResult.left.operation);
        return yield* Effect.fail(syncResult.left.failure);
      }
      return yield* Effect.fail(syncResult.left);
    });
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
