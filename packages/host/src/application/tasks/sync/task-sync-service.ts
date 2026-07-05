import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
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
  const syncActiveWorkspacePullRequests = () =>
    Effect.gen(function* () {
      const activeWorkspace = (yield* workspaceSettingsService.listWorkspaces()).find(
        (workspace) => workspace.isActive,
      );
      if (!activeWorkspace) {
        return;
      }
      const result = yield* taskService.repoPullRequestSyncDetailed({
        repoPath: activeWorkspace.repoPath,
      });
      if (result.changedTaskIds.length > 0) {
        yield* publish(
          buildTasksUpdatedEvent(eventIdFactory, activeWorkspace.repoPath, result.changedTaskIds),
        );
      }
    });
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
      return Effect.forkDaemon(
        Effect.forever(
          Effect.sleep(`${intervalMs} millis`).pipe(
            Effect.zipRight(
              syncActiveWorkspacePullRequests().pipe(
                Effect.catchAll((error) =>
                  Effect.sync(() => {
                    logger.error(
                      `Pull request sync iteration failed; the scheduler will retry on the next interval: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }),
                ),
              ),
            ),
          ),
        ),
      ).pipe(
        Effect.map((fiber) => ({
          stop() {
            return Fiber.interruptFork(fiber);
          },
        })),
      );
    },
  };
};
