import { Effect } from "effect";
import { createEventPublishingTaskService } from "../../application/tasks/event-publishing-task-service";
import {
  createTaskSyncService,
  type TaskEventPublicationReporter,
  type TaskSyncService,
} from "../../application/tasks/sync/task-sync-service";
import type {
  TaskService,
  TaskServiceWithMutationProgress,
} from "../../application/tasks/task-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskEventStream, type TaskEventStreamPort } from "../../events/task-event-stream";
import type { HostLifecycleLogger } from "../host-lifecycle";

export type NodeTaskEventServices = {
  taskEventStream: TaskEventStreamPort;
  taskService: TaskService;
  taskSyncService: TaskSyncService;
};

export const createNodeTaskEventServices = ({
  baseTaskService,
  lifecycleLogger,
  onBackgroundFailure,
  taskEventPublicationReporter,
  workspaceSettingsService,
}: {
  baseTaskService: TaskServiceWithMutationProgress;
  lifecycleLogger: HostLifecycleLogger;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
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
