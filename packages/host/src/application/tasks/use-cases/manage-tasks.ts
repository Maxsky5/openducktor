import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { TaskAssetError, TaskCreatedAssetError } from "../../../effect/task-asset-error";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import { TaskPolicyError } from "../../../domain/task";
import { requireTaskEvent, requireWorkflowIssueType } from "../support/task-workflow-events";
import { commitTaskEvent, enrichTask } from "../support/task-workflow-helpers";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "../task-mutation-progress-failure";
import type {
  CreateTaskServiceInput,
  TaskService,
  TaskServiceWithMutationProgress,
} from "../task-service";

const preserveCommittedAssetMutation = (
  operation: "create-task" | "update-task",
  taskId: string | undefined,
  error: TaskStoreError,
) => {
  if (
    error instanceof TaskAssetError &&
    error.durableState === "committed_cleanup_pending" &&
    taskId
  ) {
    return new TaskMutationProgressFailure({
      operation,
      changes: { taskIds: [taskId], removedTaskIds: [] },
      failure: error,
    });
  }
  return error;
};

export const createTaskCrudUseCases = ({
  taskStore,
  taskWorkflows,
}: CreateTaskServiceInput): Pick<TaskServiceWithMutationProgress, "createTask" | "updateTask"> &
  Pick<TaskService, "transitionTask" | "applyTaskEvent" | "applyStartEvent"> => ({
  createTask(input) {
    return Effect.gen(function* () {
      const { repoPath, task, descriptionAssets } = input;
      const workflow = taskWorkflows.forNewTask(repoPath);
      yield* requireWorkflowIssueType(workflow, task.issueType);
      const createInput: Parameters<typeof taskStore.createTask>[0] = {
        repoPath,
        task,
        status: workflow.initialState,
      };
      if (descriptionAssets) {
        createInput.descriptionAssets = descriptionAssets;
      }
      const created = yield* taskStore
        .createTask(createInput)
        .pipe(
          Effect.mapError((error) =>
            error instanceof TaskCreatedAssetError
              ? new TaskCreationProgressFailure(error.createdTask, error)
              : error,
          ),
        );

      return enrichTask(workflow, created);
    });
  },

  updateTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, patch, descriptionAssets } = input;
      if (patch.issueType !== undefined) {
        const current = yield* taskStore.getTask({ repoPath, taskId });
        yield* requireWorkflowIssueType(taskWorkflows.forTask(current), patch.issueType);
      }
      const updateInput: Parameters<typeof taskStore.updateTask>[0] = { repoPath, taskId, patch };
      if (descriptionAssets) {
        updateInput.descriptionAssets = descriptionAssets;
      }
      const updated = yield* taskStore
        .updateTask(updateInput)
        .pipe(
          Effect.mapError((error) => preserveCommittedAssetMutation("update-task", taskId, error)),
        );
      return enrichTask(taskWorkflows.forTask(updated), updated);
    });
  },

  transitionTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, status } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      const eventId = workflow.statusEvent(status);
      if (eventId === undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "status",
            message: `task_transition cannot move tasks to ${status}. Use task_close or an explicit delivery completion command.`,
            details: { repoPath, taskId, status },
          }),
        );
      }
      return yield* commitTaskEvent(taskStore, workflow, { repoPath, taskId }, current, eventId);
    });
  },

  applyTaskEvent(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, eventId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      const event = workflow.definition.events.find(({ id }) => id === eventId);
      const actionIds = workflow.definition.actions.flatMap((action) =>
        action.kind === "event" && action.eventId === eventId ? [action.id] : [],
      );
      if (!event || actionIds.length === 0) {
        return yield* new HostValidationError({
          field: "eventId",
          message: `Event ${eventId} is not sent by an event action of task workflow "${workflow.definition.id}".`,
          details: { repoPath, taskId, eventId },
        });
      }
      if (event.effect !== undefined) {
        return yield* new HostValidationError({
          field: "eventId",
          message: `Event ${eventId} runs the ${event.effect} host effect. Use the command of that effect.`,
          details: { repoPath, taskId, eventId },
        });
      }
      const decision = yield* requireTaskEvent(workflow, eventId, current);
      const available = workflow.project(current).availableActions;
      if (!actionIds.some((actionId) => available.includes(actionId))) {
        return yield* Effect.fail(
          TaskPolicyError.policy(
            `No action that sends ${eventId} is available for task ${taskId} in ${current.status}.`,
          ),
        );
      }
      if (decision.kind === "unchanged") return enrichTask(workflow, current);
      const updated = yield* taskStore.transitionTask({
        repoPath,
        taskId,
        status: decision.to,
        cause: decision.cause,
      });
      return enrichTask(workflow, updated);
    });
  },

  applyStartEvent({ repoPath, taskId, eventId }) {
    return Effect.gen(function* () {
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      if (workflow.startEventRole(eventId) === undefined) {
        return yield* new HostValidationError({
          field: "eventId",
          message: `Event ${eventId} starts no step of task workflow "${workflow.definition.id}".`,
          details: { repoPath, taskId, eventId },
        });
      }
      return yield* commitTaskEvent(taskStore, workflow, { repoPath, taskId }, current, eventId);
    });
  },
});
