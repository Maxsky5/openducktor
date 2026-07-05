import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect, Fiber, Ref } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { HostEventBusPort } from "../../../events/host-event-bus";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import type { TaskService, TaskServiceError } from "../task-service";

const TASK_EVENT_CHANNEL = "openducktor://task-event";
const DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS = 5 * 60 * 1000;
export type TaskSyncLifecycleLogger = {
  error(message: string): void;
};
export type TaskSyncLoopHandle = {
  /** Request loop shutdown without waiting for an active sync iteration to finish. */
  stop(): Effect.Effect<void, never>;
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
  taskService: Pick<TaskService, "repoPullRequestSyncDetailed">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "listWorkspaces">;
};
type PullRequestSyncResult = {
  changedTaskIds: string[];
  repoPath: string;
} | null;
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
  logger = console,
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
  const readActiveWorkspacePullRequestSync = (): Effect.Effect<
    PullRequestSyncResult,
    TaskSyncError
  > =>
    Effect.gen(function* () {
      const activeWorkspace = (yield* workspaceSettingsService.listWorkspaces()).find(
        (workspace) => workspace.isActive,
      );
      if (!activeWorkspace) {
        return null;
      }
      const result = yield* taskService.repoPullRequestSyncDetailed({
        repoPath: activeWorkspace.repoPath,
      });
      return {
        changedTaskIds: result.changedTaskIds,
        repoPath: activeWorkspace.repoPath,
      };
    });
  const publishPullRequestSyncResult = (
    result: PullRequestSyncResult,
  ): Effect.Effect<void, HostOperationError> => {
    if (!result || result.changedTaskIds.length === 0) {
      return Effect.void;
    }
    return publish(buildTasksUpdatedEvent(eventIdFactory, result.repoPath, result.changedTaskIds));
  };
  const publishPullRequestSyncResultIfRunning = (
    stopped: Ref.Ref<boolean>,
    result: PullRequestSyncResult,
  ): Effect.Effect<void, HostOperationError> => {
    return Ref.get(stopped).pipe(
      Effect.flatMap((isStopped) =>
        isStopped ? Effect.void : publishPullRequestSyncResult(result),
      ),
    );
  };
  const syncActiveWorkspacePullRequests = () =>
    readActiveWorkspacePullRequestSync().pipe(Effect.flatMap(publishPullRequestSyncResult));
  const runPullRequestSyncLoopIteration = (stopped: Ref.Ref<boolean>) =>
    readActiveWorkspacePullRequestSync().pipe(
      Effect.flatMap((result) => publishPullRequestSyncResultIfRunning(stopped, result)),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.error(
            `Pull request sync iteration failed; the scheduler will retry on the next interval: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
    );
  const runPullRequestSyncLoop = (stopped: Ref.Ref<boolean>) =>
    Effect.forever(
      Effect.sleep(`${intervalMs} millis`).pipe(
        Effect.zipRight(runPullRequestSyncLoopIteration(stopped)),
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
        const stopped = yield* Ref.make(false);
        const fiber = yield* Effect.forkDaemon(runPullRequestSyncLoop(stopped));
        return {
          stop() {
            return Ref.set(stopped, true).pipe(
              Effect.zipRight(Fiber.interruptFork(fiber)),
              Effect.asVoid,
            );
          },
        };
      });
    },
  };
};
