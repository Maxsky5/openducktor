import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
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
  publishExternalTaskCreated(repoPath: string, taskId: string): void;
  publishTasksUpdated(repoPath: string, taskIds: string[]): void;
  syncActiveWorkspacePullRequests(): Effect.Effect<void, TaskSyncError>;
  startPullRequestSyncLoop(): TaskSyncLoopHandle;
};
export type TaskSyncError = TaskServiceError | WorkspaceSettingsError;
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
  const publish = (event: ExternalTaskSyncEvent): void => {
    eventBus.publish(TASK_EVENT_CHANNEL, event);
  };
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
        publish(
          buildTasksUpdatedEvent(eventIdFactory, activeWorkspace.repoPath, result.changedTaskIds),
        );
      }
    });
  return {
    publishExternalTaskCreated(repoPath, taskId) {
      publish(buildExternalTaskCreatedEvent(eventIdFactory, repoPath, taskId));
    },
    publishTasksUpdated(repoPath, taskIds) {
      if (taskIds.length === 0) {
        return;
      }
      publish(buildTasksUpdatedEvent(eventIdFactory, repoPath, taskIds));
    },
    syncActiveWorkspacePullRequests,
    startPullRequestSyncLoop() {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let activeIteration: Fiber.RuntimeFiber<void, never> | null = null;
      const scheduleNext = (): void => {
        if (stopped) {
          return;
        }
        timer = setTimeout(startIteration, intervalMs);
      };
      const startIteration = (): void => {
        timer = null;
        activeIteration = Effect.runFork(
          syncActiveWorkspacePullRequests().pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                logger.error(
                  `Pull request sync iteration failed; the scheduler will retry on the next interval: ${error instanceof Error ? error.message : String(error)}`,
                );
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                activeIteration = null;
                scheduleNext();
              }),
            ),
          ),
        );
      };
      scheduleNext();
      return {
        stop() {
          return Effect.gen(function* () {
            stopped = true;
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            const iteration = activeIteration;
            if (iteration) {
              yield* Fiber.join(iteration);
            }
            activeIteration = null;
          });
        },
      };
    },
  };
};
