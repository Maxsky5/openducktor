import { type IssueType, TASK_CLOSED_STATE, TASK_OPEN_STATE } from "@openducktor/contracts";
import type {
  TaskEventDecision,
  TaskEventDenial,
  TaskFacts,
  TaskWorkflow,
  TaskWorkflowRole,
} from "@openducktor/workflows";
import { Effect, Result } from "effect";
import { TaskPolicyError } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";

export type AdmittedTaskEvent = Exclude<TaskEventDecision, { kind: "denied" }>;

/** Re-evaluates policy against the row locked by the repository write transaction. */
export const decideTaskTransition = (workflow: TaskWorkflow, eventId: string, task: TaskFacts) => {
  const decision = workflow.decide(eventId, task);
  return decision.kind === "denied"
    ? Result.fail(taskEventPolicyError(eventId, task, decision))
    : Result.succeed({
        ...decisionTransition(decision),
        workflowId: workflow.definition.id,
      });
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

/** An OpenDucktor task action that every workflow has, without a workflow event. */
export type CoreTaskAction = "close" | "reset";

/**
 * Decides a core task action. Close Task moves any task to `closed`, and a closed task stays
 * unchanged. Reset Task moves any task except a closed one to `open`.
 */
export const decideCoreTaskAction = (
  action: CoreTaskAction,
  task: TaskFacts,
): Result.Result<AdmittedTaskEvent, HostValidationError<{ taskId: string; status: string }>> => {
  if (action === "reset" && task.status === TASK_CLOSED_STATE)
    return Result.fail(
      new HostValidationError({
        field: "taskId",
        message: `Task ${task.id} is closed, so it cannot reset. Reset only a task that is not closed.`,
        details: { taskId: task.id, status: task.status },
      }),
    );
  const to = action === "close" ? TASK_CLOSED_STATE : TASK_OPEN_STATE;
  return Result.succeed(
    task.status === to
      ? { kind: "unchanged", status: task.status }
      : { kind: "transition", from: task.status, to, cause: {} },
  );
};

/** The store decision of a core task action, made again for each locked task row. */
export const coreTaskTransition =
  (taskWorkflows: Pick<TaskWorkflowResolver, "forTask">, action: CoreTaskAction) =>
  (task: TaskFacts) =>
    Result.map(decideCoreTaskAction(action, task), (decision) => ({
      ...decisionTransition(decision),
      workflowId: taskWorkflows.forTask(task).definition.id,
    }));

/** The store write of an admitted event. A repeat writes the current status without a cause. */
export const decisionTransition = (decision: AdmittedTaskEvent) => ({
  status: decision.kind === "transition" ? decision.to : decision.status,
  cause: decision.kind === "transition" ? decision.cause : {},
});

/**
 * Pull request management is an OpenDucktor feature, so no workflow event controls it. A closed
 * task keeps its pull request.
 */
export const requirePullRequestManagement = (
  task: TaskFacts,
): Effect.Effect<void, TaskPolicyError> =>
  task.status === TASK_CLOSED_STATE
    ? Effect.fail(
        TaskPolicyError.policy(
          `Task ${task.id} is closed, so its pull request cannot change. Manage pull requests only for a task that is not closed.`,
        ),
      )
    : Effect.void;

/** A person approves only a task that is not closed and whose workflow approval is available. */
export const requireApprovalAvailable = (
  workflow: TaskWorkflow,
  task: TaskFacts,
): Effect.Effect<void, HostValidationError> => {
  if (task.status !== TASK_CLOSED_STATE && workflow.approvalAvailable(task)) return Effect.void;
  if (workflow.approvalAction === undefined)
    return Effect.fail(
      new HostValidationError({
        message: `Task workflow "${workflow.definition.id}" has no approval action. Add one to approve its tasks.`,
      }),
    );
  const approvalStates = workflow.definition.states
    .map(({ id }) => id)
    .filter(
      (status) => status !== TASK_CLOSED_STATE && workflow.approvalAvailable({ ...task, status }),
    );
  return Effect.fail(
    new HostValidationError({
      message:
        approvalStates.length === 0
          ? `Human approval is not available for task ${task.id}. Complete the workflow steps that its approval needs first.`
          : `Human approval is only allowed from ${formatStatusList(approvalStates)}.`,
    }),
  );
};

const taskEventPolicyError = (
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

/** Decides a named event for a command that reports a status denial as invalid input. */
export const requireTaskEventInput = <Details extends object>(
  subject: string,
  workflow: TaskWorkflow,
  eventId: string,
  task: TaskFacts,
  details: Details,
): Effect.Effect<AdmittedTaskEvent, HostValidationError<Details>> =>
  Effect.fromResult(decideTaskEventInput(subject, workflow, eventId, task, details));

export const decideTaskEventInput = <Details extends object>(
  subject: string,
  workflow: TaskWorkflow,
  eventId: string,
  task: TaskFacts,
  details: Details,
): Result.Result<AdmittedTaskEvent, HostValidationError<Details>> => {
  const decision = workflow.decide(eventId, task);
  if (decision.kind !== "denied") return Result.succeed(decision);
  return Result.fail(
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
  issueType: IssueType,
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
