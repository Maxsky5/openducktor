import type { TaskArtifactChange, TaskCard } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect, Result, type Scope } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import {
  createHostEffectRegistry,
  type HostEffectError,
} from "../host-effects/host-effect-registry";
import { decideTaskTransition } from "../support/task-workflow-events";
import { commitWorkflowEvent, enrichTask } from "../support/task-workflow-helpers";
import { mapTaskMutationProgressErrors } from "../task-error-mapping";
import type { ApplyTaskEventInput } from "../task-inputs";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

type TaskTransition = Result.Result.Success<ReturnType<typeof decideTaskTransition>>;

/**
 * Decides an event that an available event action of the task sends. Other events have their own
 * paths: artifact saves, step starts, and agent events.
 */
const decideEventAction = (
  workflow: TaskWorkflow,
  task: TaskRecord,
  { repoPath, taskId, eventId }: ApplyTaskEventInput,
): Result.Result<TaskTransition, TaskPolicyError | HostValidationErrorAggregate> => {
  const actionIds = workflow.definition.actions.flatMap((action) =>
    action.kind === "event" && action.eventId === eventId ? [action.id] : [],
  );
  if (actionIds.length === 0)
    return Result.fail(
      new HostValidationError({
        field: "eventId",
        message: `Event ${eventId} is not sent by an event action of task workflow "${workflow.definition.id}".`,
        details: { repoPath, taskId, eventId },
      }),
    );
  const available = workflow.project(task).availableActions;
  if (!actionIds.some((actionId) => available.includes(actionId)))
    return Result.fail(
      TaskPolicyError.policy(
        `No action that sends ${eventId} is available for task ${taskId} in ${task.status}.`,
      ),
    );
  return decideTaskTransition(workflow, eventId, task);
};

/**
 * Applies a workflow event by its ID. The host runs the host effects of the event in order, then
 * commits the event through the one workflow event commit. When an effect fails, the event does
 * not commit.
 */
export const createTaskEventUseCase = (
  input: TaskServiceUseCaseInput,
): Pick<TaskServiceWithMutationProgress, "applyTaskEvent"> => {
  const { taskStore, taskWorkflows } = input;
  const hostEffects = createHostEffectRegistry(input);
  return {
    applyTaskEvent(request) {
      return Effect.gen(function* () {
        const current = yield* taskStore.getTask(request);
        const workflow = taskWorkflows.forTask(current);
        yield* Effect.fromResult(decideEventAction(workflow, current, request));
        const artifactChanges: TaskArtifactChange[] = [];
        const commit: Effect.Effect<TaskCard, HostEffectError, Scope.Scope> = commitWorkflowEvent(
          taskStore,
          request,
          (task) => decideEventAction(taskWorkflows.forTask(task), task, request),
        ).pipe(
          Effect.map((updated) => enrichTask(taskWorkflows.forTask(updated), updated)),
          mapTaskMutationProgressErrors,
        );
        const { workspaceId, repoPath, taskId, eventId } = request;
        const context = { input: { workspaceId, repoPath, taskId }, eventId, artifactChanges };
        const task = yield* workflow
          .eventEffects(eventId)
          .reduceRight((next, effect) => hostEffects[effect](context, next), commit);
        return { task, artifactChanges };
      }).pipe(Effect.scoped, mapTaskMutationProgressErrors);
    },
  };
};
