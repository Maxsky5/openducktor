import { Effect } from "effect";
import {
  createEventPublishingTaskService,
  type EventPublishingTaskService,
} from "../../application/tasks/event-publishing-task-service";
import {
  createTaskSyncService,
  type TaskEventPublicationReporter,
  type TaskSyncService,
} from "../../application/tasks/sync/task-sync-service";
import type { TaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { createTaskEventStream, type TaskEventStreamPort } from "../../events/task-event-stream";
import type { HostLifecycleLogger } from "../host-lifecycle";

export type NodeTaskEventServices = {
  taskEventStream: TaskEventStreamPort;
  taskService: EventPublishingTaskService;
  taskSyncService: TaskSyncService;
};

export const createNodeTaskEventServices = ({
  baseTaskService,
  acceptNotificationInput,
  lifecycleLogger,
  onBackgroundFailure,
  taskEventPublicationReporter,
  workspaceSettingsService,
}: {
  baseTaskService: TaskServiceWithMutationProgress;
  acceptNotificationInput?:
    | ((event: import("@openducktor/contracts").ExternalTaskSyncEvent) => void)
    | undefined;
  lifecycleLogger: HostLifecycleLogger;
  onBackgroundFailure(failure: HostOperationErrorAggregate): Effect.Effect<void, never>;
  taskEventPublicationReporter: TaskEventPublicationReporter;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskEventServices => {
  const taskEventStream = createTaskEventStream({
    reporter: {
      report: (failure) =>
        Effect.runFork(
          onBackgroundFailure(
            new HostOperationError({
              operation: "task-event-stream.delivery",
              message: "Task event stream subscriber delivery failed.",
              cause: failure.cause,
              details: { frame: failure.frame, subscriptionId: failure.subscriptionId },
            }),
          ),
        ),
    },
  });
  const taskSyncService = createTaskSyncService({
    acceptNotificationInput,
    logger: lifecycleLogger,
    onBackgroundFailure,
    publicationReporter: taskEventPublicationReporter,
    taskEventStream,
    taskService: baseTaskService,
    workspaceSettingsService,
  });

  return {
    taskEventStream,
    taskService: createEventPublishingTaskService({
      taskService: baseTaskService,
      taskSyncService,
    }),
    taskSyncService,
  };
};
