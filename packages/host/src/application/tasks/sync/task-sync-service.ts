import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { type Cause, Deferred, Effect, Exit, Fiber, Ref } from "effect";
import { errorMessage, HostOperationError } from "../../../effect/host-errors";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import { RepoPullRequestSyncPartialFailure } from "../repo-pull-request-sync-partial-failure";
import type { TaskService, TaskServiceError } from "../task-service";

const TASK_EVENT_CHANNEL = "openducktor://task-event";
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
  publishExternalTaskCreated(
    repoPath: string,
    taskId: string,
  ): Effect.Effect<void, HostOperationError>;
  publishTasksUpdated(repoPath: string, taskIds: string[]): Effect.Effect<void, HostOperationError>;
  syncActiveWorkspacePullRequests(): Effect.Effect<void, TaskSyncError>;
  startPullRequestSyncLoop(): Effect.Effect<TaskSyncLoopHandle, never>;
};
export type TaskSyncError = HostOperationError | TaskServiceError | WorkspaceSettingsError;
export type CreateTaskSyncServiceInput = {
  eventBus: HostEventBusPort;
  eventIdFactory?: () => string;
  intervalMs?: number;
  logger?: TaskSyncLifecycleLogger;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
  taskService: Pick<TaskService, "repoPullRequestSyncDetailed">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "listWorkspaces">;
};
const defaultTaskSyncLifecycleLogger: TaskSyncLifecycleLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
};
type PullRequestSyncResult = {
  changedTaskIds: string[];
  repoPath: string;
} | null;
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
  taskIds: string[],
): ExternalTaskSyncEvent => ({
  eventId: eventIdFactory(),
  kind: "tasks_updated",
  repoPath,
  taskIds,
  emittedAt: nowIso(),
});
export const createTaskSyncService = ({
  eventBus,
  eventIdFactory = () => crypto.randomUUID(),
  intervalMs = DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS,
  logger = defaultTaskSyncLifecycleLogger,
  onBackgroundFailure,
  taskService,
  workspaceSettingsService,
}: CreateTaskSyncServiceInput): TaskSyncService => {
  const publish = (event: ExternalTaskSyncEvent): Effect.Effect<void, HostOperationError> =>
    Effect.try({
      try: () => eventBus.publish(TASK_EVENT_CHANNEL, event),
      catch: (cause) =>
        new HostOperationError({
          operation: "task-sync.publish-event",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: { channel: TASK_EVENT_CHANNEL, eventKind: event.kind },
        }),
    });
  const publishPullRequestSyncResult = (
    result: PullRequestSyncResult,
  ): Effect.Effect<void, HostOperationError> => {
    const changedTaskIds = result ? [...new Set(result.changedTaskIds)] : [];
    if (!result || changedTaskIds.length === 0) {
      return Effect.void;
    }
    return publish(buildTasksUpdatedEvent(eventIdFactory, result.repoPath, changedTaskIds));
  };
  const publishPullRequestSyncResultIfRunning = (
    state: Ref.Ref<TaskSyncLoopState>,
    result: PullRequestSyncResult,
  ): Effect.Effect<void, HostOperationError> =>
    Ref.get(state).pipe(
      Effect.flatMap(({ stopped }) =>
        stopped ? Effect.void : publishPullRequestSyncResult(result),
      ),
    );
  const syncActiveWorkspacePullRequests = (
    publishResult: (
      result: PullRequestSyncResult,
    ) => Effect.Effect<void, HostOperationError> = publishPullRequestSyncResult,
  ): Effect.Effect<void, TaskSyncError> =>
    Effect.gen(function* () {
      const activeWorkspace = (yield* workspaceSettingsService.listWorkspaces()).find(
        (workspace) => workspace.isActive,
      );
      if (!activeWorkspace) {
        return;
      }
      const syncResult = yield* Effect.either(
        taskService.repoPullRequestSyncDetailed({ repoPath: activeWorkspace.repoPath }),
      );
      if (syncResult._tag === "Right") {
        yield* publishResult({
          changedTaskIds: syncResult.right.changedTaskIds,
          repoPath: activeWorkspace.repoPath,
        });
        return;
      }
      if (!(syncResult.left instanceof RepoPullRequestSyncPartialFailure)) {
        return yield* Effect.fail(syncResult.left);
      }
      const publicationResult = yield* Effect.either(
        publishResult({
          changedTaskIds: syncResult.left.changedTaskIds,
          repoPath: activeWorkspace.repoPath,
        }),
      );
      if (publicationResult._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "task-sync.pull-request-sync",
            message: `${errorMessage(syncResult.left.failure)}\nTask cache invalidation failed: ${errorMessage(publicationResult.left)}`,
            cause: syncResult.left.failure,
            details: {
              mutationFailure: syncResult.left.failure,
              publicationFailure: publicationResult.left,
              repoPath: activeWorkspace.repoPath,
              taskIds: syncResult.left.changedTaskIds,
            },
          }),
        );
      }
      return yield* Effect.fail(syncResult.left.failure);
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
    syncActiveWorkspacePullRequests((result) =>
      publishPullRequestSyncResultIfRunning(state, result),
    ).pipe(Effect.catchAll((error) => writePullRequestSyncIterationFailure(state, error)));
  const runPullRequestSyncLoop = (state: Ref.Ref<TaskSyncLoopState>) =>
    Effect.forever(
      Effect.sleep(`${intervalMs} millis`).pipe(
        Effect.zipRight(runPullRequestSyncLoopIteration(state)),
      ),
    );
  return {
    publishExternalTaskCreated(repoPath, taskId) {
      return publish(buildExternalTaskCreatedEvent(eventIdFactory, repoPath, taskId));
    },
    publishTasksUpdated(repoPath, taskIds) {
      if (taskIds.length === 0) {
        return Effect.void;
      }
      return publish(buildTasksUpdatedEvent(eventIdFactory, repoPath, taskIds));
    },
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
