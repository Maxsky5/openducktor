import { Effect, Result } from "effect";
import type { TaskPolicyError } from "../../../domain/task";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { decideTaskTransition } from "../support/task-workflow-events";
import { commitWorkflowEvent, enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

/** Commits an agent event. An agent event has no host effects, so it only changes the state. */
export const createTaskAgentEventUseCase = ({
  taskStore,
  taskWorkflows,
}: CreateTaskServiceInput): Pick<TaskService, "applyAgentEvent"> => ({
  applyAgentEvent(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, eventId } = input;
      const updated = yield* commitWorkflowEvent<TaskPolicyError | HostValidationErrorAggregate>(
        taskStore,
        input,
        (current) => {
          const workflow = taskWorkflows.forTask(current);
          if (!workflow.agentEvent(eventId))
            return Result.fail(
              new HostValidationError({
                field: "eventId",
                message: `Event ${eventId} is not an agent event of task workflow "${workflow.definition.id}".`,
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
