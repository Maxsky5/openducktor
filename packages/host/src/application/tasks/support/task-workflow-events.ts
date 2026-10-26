import type { WorkflowEventEffect } from "@openducktor/contracts";
import type {
  TaskEventDecision,
  TaskEventDenial,
  TaskFacts,
  TaskWorkflow,
  TaskWorkflowRole,
  TransitionCause,
} from "@openducktor/workflows";
import { Effect } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";

export type AdmittedTaskEvent = Exclude<TaskEventDecision, { kind: "denied" }>;
export type HostEffect = Exclude<WorkflowEventEffect, "status.set">;

/** The event of a host effect. A workflow without that event cannot run the command. */
export const requireEffectEvent = (
  workflow: TaskWorkflow,
  effect: HostEffect,
): Effect.Effect<string, TaskPolicyError> => {
  const eventId = workflow.effectEvent(effect);
  return eventId === undefined
    ? Effect.fail(
        TaskPolicyError.policy(
          `Task workflow "${workflow.definition.id}" has no event with the ${effect} effect. Add one to use this command.`,
        ),
      )
    : Effect.succeed(eventId);
};

/** Decides a named workflow event. A denial fails with its task policy error. */
export const requireTaskEvent = (
  workflow: TaskWorkflow,
  eventId: string,
  task: TaskFacts,
): Effect.Effect<AdmittedTaskEvent, TaskPolicyError> => {
  const decision = workflow.decide(eventId, task);
  return decision.kind === "denied"
    ? Effect.fail(taskEventPolicyError(eventId, task, decision))
    : Effect.succeed(decision);
};

/** Decides the event of a host effect. */
export const requireEffect = (
  workflow: TaskWorkflow,
  effect: HostEffect,
  task: TaskFacts,
): Effect.Effect<AdmittedTaskEvent, TaskPolicyError> =>
  requireEffectEvent(workflow, effect).pipe(
    Effect.flatMap((eventId) => requireTaskEvent(workflow, eventId, task)),
  );

/** The status after an admitted event, which equals the current status for a repeat. */
export const resultingStatus = (decision: AdmittedTaskEvent): string =>
  decision.kind === "transition" ? decision.to : decision.status;

/** The signal and source role that a committed transition reports. A repeat reports none. */
export const transitionCause = (decision: AdmittedTaskEvent): TransitionCause =>
  decision.kind === "transition" ? decision.cause : {};

/** The store write of an admitted event. A repeat writes the current status without a cause. */
export const decisionTransition = (decision: AdmittedTaskEvent) => ({
  status: resultingStatus(decision),
  cause: transitionCause(decision),
});

export const requirePullRequestManagement = (
  workflow: TaskWorkflow,
  task: TaskFacts,
): Effect.Effect<void, TaskPolicyError> =>
  Effect.gen(function* () {
    const eventId = yield* requireEffectEvent(workflow, "pull_request.manage");
    if (workflow.isEventAvailable(eventId, task)) return;
    return yield* TaskPolicyError.policy(
      `Pull request management is only available from ${formatStatusList(workflow.eventSourceStates(eventId))}.`,
    );
  });

/** A person approves only an open task that the approval event admits. */
export const requireHumanReviewStatus = (
  workflow: TaskWorkflow,
  task: TaskFacts,
): Effect.Effect<void, TaskPolicyError | HostValidationError> =>
  Effect.gen(function* () {
    const eventId = yield* requireEffectEvent(workflow, "review.approve");
    if (!workflow.isTerminalState(task.status) && workflow.isEventAvailable(eventId, task)) return;
    const reviewStatuses = workflow
      .eventSourceStates(eventId)
      .filter((status) => !workflow.isTerminalState(status));
    return yield* new HostValidationError({
      message: `Human approval is only allowed from ${formatStatusList(reviewStatuses)}.`,
    });
  });

export const taskEventPolicyError = (
  eventId: string,
  task: TaskFacts,
  denial: TaskEventDenial,
): TaskPolicyError => {
  const statuses = formatStatusList(denial.allowedStatuses);
  const recovery =
    denial.guardMessage === undefined
      ? `Use it from ${statuses}.`
      : `${denial.guardMessage}, then use it from ${statuses}.`;
  return TaskPolicyError.transitionNotAllowed(
    `${eventId} is not allowed for task ${task.id} (${task.issueType}) from ${task.status}. ${recovery}`,
  );
};

/** Decides the event of a host effect for a command that reports a denial as invalid input. */
export const requireEffectInput = <Details extends object>(
  subject: string,
  workflow: TaskWorkflow,
  effect: HostEffect,
  task: TaskFacts,
  details: Details,
): Effect.Effect<AdmittedTaskEvent, TaskPolicyError | HostValidationError<Details>> =>
  requireEffectEvent(workflow, effect).pipe(
    Effect.flatMap((eventId) => requireTaskEventInput(subject, workflow, eventId, task, details)),
  );

/** Decides a named event for a command that reports a status denial as invalid input. */
export const requireTaskEventInput = <Details extends object>(
  subject: string,
  workflow: TaskWorkflow,
  eventId: string,
  task: TaskFacts,
  details: Details,
): Effect.Effect<AdmittedTaskEvent, HostValidationError<Details>> => {
  const decision = workflow.decide(eventId, task);
  if (decision.kind !== "denied") return Effect.succeed(decision);
  return Effect.fail(
    new HostValidationError({
      field: "taskId",
      message:
        decision.guardMessage === undefined
          ? `${subject} only allowed from ${formatStatusList(decision.allowedStatuses)} (current: ${task.status}).`
          : `${subject} not allowed yet. ${decision.guardMessage}.`,
      details,
    }),
  );
};

/** An issue type must be one of the task workflow. */
export const requireWorkflowIssueType = (
  workflow: TaskWorkflow,
  issueType: string,
): Effect.Effect<void, HostValidationError<{ issueType: string }>> =>
  workflow.issueTypes.includes(issueType)
    ? Effect.void
    : Effect.fail(
        new HostValidationError({
          field: "issueType",
          message: `Issue type ${issueType} is not in task workflow "${workflow.definition.id}". Use ${workflow.issueTypes.join(", ")}.`,
          details: { issueType },
        }),
      );

/** A role of the task workflow, or an error that lists its roles. */
export const requireWorkflowRole = (
  workflow: TaskWorkflow,
  role: string,
): Effect.Effect<TaskWorkflowRole, HostValidationError<{ role: string }>> =>
  workflow.hasRole(role)
    ? Effect.succeed(workflow.role(role))
    : Effect.fail(
        new HostValidationError({
          field: "role",
          message: `Role ${role} is not in task workflow "${workflow.definition.id}". Use ${workflow.definition.roles.map(({ id }) => id).join(", ")}.`,
          details: { role },
        }),
      );

export const formatStatusList = (statuses: readonly string[]): string => {
  if (statuses.length < 3) return statuses.join(" or ");
  return `${statuses.slice(0, -1).join(", ")}, or ${statuses.at(-1)}`;
};

/** Tells the user to start a session of a role that creates the task worktree. */
export const startWorktreeSessionHint = (workflow: TaskWorkflow): string =>
  `Start a ${formatStatusList(workflow.worktreeRoles.map((role) => workflow.role(role).label))} session first.`;
