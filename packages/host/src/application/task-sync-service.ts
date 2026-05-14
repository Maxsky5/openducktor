import { randomUUID } from "node:crypto";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { HostEventBusPort } from "../events/host-event-bus";
import type { TaskService } from "./task-service";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

const TASK_EVENT_CHANNEL = "openducktor://task-event";
const DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type TaskSyncLifecycleLogger = {
  error(message: string): void;
};

export type TaskSyncLoopHandle = {
  stop(): Promise<void>;
};

export type TaskSyncService = {
  publishExternalTaskCreated(repoPath: string, taskId: string): void;
  publishTasksUpdated(repoPath: string, taskIds: string[]): void;
  startPullRequestSyncLoop(): TaskSyncLoopHandle;
};

export type CreateTaskSyncServiceInput = {
  eventBus: HostEventBusPort;
  intervalMs?: number;
  logger?: TaskSyncLifecycleLogger;
  taskService: Pick<TaskService, "repoPullRequestSyncDetailed">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "listWorkspaces">;
};

const nowIso = (): string => new Date().toISOString();

const buildExternalTaskCreatedEvent = (
  repoPath: string,
  taskId: string,
): ExternalTaskSyncEvent => ({
  eventId: randomUUID(),
  kind: "external_task_created",
  repoPath,
  taskId,
  emittedAt: nowIso(),
});

const buildTasksUpdatedEvent = (repoPath: string, taskIds: string[]): ExternalTaskSyncEvent => ({
  eventId: randomUUID(),
  kind: "tasks_updated",
  repoPath,
  taskIds,
  emittedAt: nowIso(),
});

export const createTaskSyncService = ({
  eventBus,
  intervalMs = DEFAULT_PULL_REQUEST_SYNC_INTERVAL_MS,
  logger = console,
  taskService,
  workspaceSettingsService,
}: CreateTaskSyncServiceInput): TaskSyncService => {
  const publish = (event: ExternalTaskSyncEvent): void => {
    eventBus.publish(TASK_EVENT_CHANNEL, event);
  };

  return {
    publishExternalTaskCreated(repoPath, taskId) {
      publish(buildExternalTaskCreatedEvent(repoPath, taskId));
    },

    publishTasksUpdated(repoPath, taskIds) {
      if (taskIds.length === 0) {
        return;
      }
      publish(buildTasksUpdatedEvent(repoPath, taskIds));
    },

    startPullRequestSyncLoop() {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let activeIteration: Promise<void> | null = null;

      const runIteration = async (): Promise<void> => {
        const activeWorkspace = (await workspaceSettingsService.listWorkspaces()).find(
          (workspace) => workspace.isActive,
        );
        if (!activeWorkspace) {
          return;
        }

        const result = await taskService.repoPullRequestSyncDetailed({
          repoPath: activeWorkspace.repoPath,
        });
        if (result.changedTaskIds.length > 0) {
          publish(buildTasksUpdatedEvent(activeWorkspace.repoPath, result.changedTaskIds));
        }
      };

      const scheduleNext = (): void => {
        if (stopped) {
          return;
        }
        timer = setTimeout(startIteration, intervalMs);
      };

      const startIteration = (): void => {
        timer = null;
        activeIteration = runIteration()
          .catch((error: unknown) => {
            logger.error(
              `Pull request sync iteration failed; the scheduler will retry on the next interval: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          })
          .finally(() => {
            activeIteration = null;
            scheduleNext();
          });
      };

      startIteration();

      return {
        async stop() {
          stopped = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          await activeIteration;
        },
      };
    },
  };
};
