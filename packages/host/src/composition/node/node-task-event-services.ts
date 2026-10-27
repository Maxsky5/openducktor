import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { Effect } from "effect";
import {
  createEventPublishingTaskService,
  type EventPublishingTaskService,
} from "../../application/tasks/event-publishing-task-service";
import {
  createTaskSyncService,
  type CreateTaskSyncServiceInput,
  type TaskEventPublicationReporter,
  type TaskSyncService,
} from "../../application/tasks/sync/task-sync-service";
import type { TaskServiceWithMutationProgress } from "../../application/tasks/task-service";
import type { CommittedTaskStatusChangeObserver } from "../../application/tasks/task-mutation-operation";
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
  taskWorkflows,
  acceptNotificationInput,
  observeStatusChanges,
  lifecycleLogger,
  mergeDetection,
  onBackgroundFailure,
  taskEventPublicationReporter,
  workspaceSettingsService,
}: {
  baseTaskService: TaskServiceWithMutationProgress;
  taskWorkflows: TaskWorkflowResolver;
  acceptNotificationInput?:
    | ((event: import("@openducktor/contracts").ExternalTaskSyncEvent) => void)
    | undefined;
  observeStatusChanges: CommittedTaskStatusChangeObserver;
  lifecycleLogger: HostLifecycleLogger;
  mergeDetection: CreateTaskSyncServiceInput["mergeDetection"];
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
    observeStatusChanges,
    logger: lifecycleLogger,
    mergeDetection,
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
      taskWorkflows,
      taskSyncService,
    }),
    taskSyncService,
  };
};
