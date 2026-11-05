import { TASK_OPEN_STATE } from "@openducktor/contracts";
import { Effect, Result } from "effect";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { TaskAssetError, TaskCreatedAssetError } from "../../../effect/task-asset-error";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import type { TaskPolicyError } from "../../../domain/task";
import { decideTaskTransition, requireWorkflowIssueType } from "../support/task-workflow-events";
import { commitWorkflowEvent, enrichTask } from "../support/task-workflow-helpers";
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
  Pick<TaskService, "applyStartEvent"> => ({
  createTask(input) {
    return Effect.gen(function* () {
      const { repoPath, task, descriptionAssets } = input;
      const workflow = taskWorkflows.forNewTask(repoPath);
      yield* requireWorkflowIssueType(workflow, task.issueType);
      const createInput: Parameters<typeof taskStore.createTask>[0] = {
        workspaceId: input.workspaceId,
        repoPath,
        task,
        status: TASK_OPEN_STATE,
      };
      if (descriptionAssets) {
        createInput.descriptionAssets = descriptionAssets;
      }
      const created = yield* taskStore.createTask(createInput).pipe(
        Effect.mapError((error) =>
          error instanceof TaskCreatedAssetError
            ? new TaskCreationProgressFailure(
                {
                  ...error.createdTask,
                  workflow: {
                    id: workflow.definition.id,
                    revision: workflow.definition.revision,
                  },
                },
                error,
              )
            : error,
        ),
      );

      return enrichTask(workflow, created);
    });
  },

  updateTask(input) {
    return Effect.gen(function* () {
      const { taskId, patch } = input;
      if (patch.issueType !== undefined) {
        const current = yield* taskStore.getTask(input);
        yield* requireWorkflowIssueType(taskWorkflows.forTask(current), patch.issueType);
      }
      const updated = yield* taskStore
        .updateTask(input)
        .pipe(
          Effect.mapError((error) => preserveCommittedAssetMutation("update-task", taskId, error)),
        );
      return enrichTask(taskWorkflows.forTask(updated), updated);
    });
  },

  applyStartEvent(input) {
    const { repoPath, taskId, eventId } = input;
    return Effect.gen(function* () {
      const updated = yield* commitWorkflowEvent<HostValidationErrorAggregate | TaskPolicyError>(
        taskStore,
        input,
        (current) => {
          const workflow = taskWorkflows.forTask(current);
          if (workflow.startEventRole(eventId) === undefined)
            return Result.fail(
              new HostValidationError({
                field: "eventId",
                message: `Event ${eventId} starts no step of task workflow "${workflow.definition.id}".`,
                details: { repoPath, taskId, eventId },
              }),
            );
          return decideTaskTransition(workflow, eventId, current);
        },
      );
      return enrichTask(taskWorkflows.forTask(updated), updated);
    });
  },
});
