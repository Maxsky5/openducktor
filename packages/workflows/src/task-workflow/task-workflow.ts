import type {
  AgentSessionStartMode,
  AgentWorkflowState,
  AgentWorkflows,
  CompiledWorkflowDefinition,
  NotificationKindSetting,
  TaskArtifactSummary,
  WorkflowDefinition,
  WorkflowEventEffect,
  WorkflowNotificationKind,
} from "@openducktor/contracts";
import { deepFreeze } from "../deep-freeze";
import { createWorkflow, WorkflowEvaluationError, type Workflow } from "../evaluate";
import { workflowNotificationDefaults } from "../notification-defaults";
import { createTaskInputs, taskIssueTypes, type TaskFacts } from "./task-input";
import { createTaskPrompts, type PromptTemplate, type TaskPrompts } from "./task-prompts";

type Definition = CompiledWorkflowDefinition;
export type TaskWorkflowRole = Definition["roles"][number];
export type TaskWorkflowState = Definition["states"][number];
export type TaskWorkflowArtifact = Definition["artifacts"][number];
type AgentStep = Extract<Definition["steps"][number], { kind: "agent" }>;
export type TaskWorkflowLaunchAction = AgentStep["launchActions"][number] & { role: string };
/** An automation with the role of its launch action and the start mode that Autopilot uses. */
export type TaskWorkflowAutomation = Definition["automations"][number] & {
  role: string;
  startMode: AgentSessionStartMode;
};

/** The Autopilot signal and the source role that a committed transition reports. */
export type TransitionCause = { signal?: string; sourceRole?: string };

export type TaskEventDenial = {
  kind: "denied";
  status: string;
  /** Source states that admit the event for this task. */
  allowedStatuses: string[];
  /** The recovery of the guard that denied the event. */
  guardMessage?: string;
};

export type TaskEventDecision =
  | { kind: "unchanged"; status: string }
  | { kind: "transition"; from: string; to: string; cause: TransitionCause }
  | TaskEventDenial;

/** Tasks with equal inputs share one frozen projection, so a task card can hold it as is. */
export type TaskProjection = {
  readonly availableActions: string[];
  readonly agentWorkflows: AgentWorkflows;
};

export type TaskStateNotification = {
  kind: WorkflowNotificationKind;
  status: string;
  preferredRole?: string;
  navigation: { type: "kanban_task" } | { type: "agent_studio_task"; preferredRole?: string };
};

/**
 * The queries that the host and the clients run on one task workflow. Each query reads the
 * definition, so a new definition works without code changes.
 */
export type TaskWorkflow = {
  readonly definition: Definition;
  readonly prompts: TaskPrompts;
  readonly issueTypes: readonly string[];
  readonly initialState: string;
  /** The task states that end the task. */
  readonly terminalStates: readonly string[];
  /** The review artifacts. An implementation reset drops them. */
  readonly reviewArtifactCodes: readonly string[];
  /** Roles whose sessions run in the task worktree. */
  readonly worktreeRoles: readonly string[];
  isTerminalState(status: string): boolean;
  state(status: string): TaskWorkflowState;
  role(roleId: string): TaskWorkflowRole;
  hasRole(roleId: string): boolean;
  /** The workflow artifact of a code, or undefined for a free artifact code. */
  artifact(code: string): TaskWorkflowArtifact | undefined;
  /** The event that a submit sends: the event of the review verdict, or the document save event. */
  artifactSubmitEvent(code: string, verdict: string | undefined): string | undefined;
  emptyArtifactSummary(): TaskArtifactSummary;
  /** The event of a host effect. A host command fails when the workflow has no event for it. */
  effectEvent(effect: Exclude<WorkflowEventEffect, "status.set">): string | undefined;
  /** The status.set event that moves a task to the status. */
  statusEvent(status: string): string | undefined;
  decide(eventId: string, task: TaskFacts): TaskEventDecision;
  isEventAvailable(eventId: string, task: TaskFacts): boolean;
  eventSourceStates(eventId: string): readonly string[];
  /** Tasks with equal inputs share one frozen projection. */
  project(task: TaskFacts): TaskProjection;
  launchAction(launchActionId: string): TaskWorkflowLaunchAction;
  /** The event that a session start of the role step must admit, if any. */
  roleStartEvent(roleId: string): string | undefined;
  /** The role of the step that the event starts. */
  startEventRole(eventId: string): string | undefined;
  automation(automationId: string): TaskWorkflowAutomation;
  /** The notification of a move to the status. The source role of the transition comes first. */
  stateNotification(status: string, sourceRole?: string): TaskStateNotification | undefined;
  notificationDefaults(): Partial<Record<WorkflowNotificationKind, NotificationKindSetting>>;
};

const lookup = <Value>(
  definitionId: string,
  kind: string,
  entries: Iterable<readonly [string, Value]>,
) => {
  const values = new Map(entries);
  return (id: string): Value => {
    const value = values.get(id);
    if (value === undefined)
      throw new Error(`Task workflow "${definitionId}" has no ${kind} "${id}".`);
    return value;
  };
};

/** Builds the task workflow of a definition and its prompt templates. */
export const createTaskWorkflow = (
  source: WorkflowDefinition,
  templates: readonly PromptTemplate[],
): TaskWorkflow => {
  const evaluator = createWorkflow(source);
  const { definition } = evaluator;
  const issueTypes = taskIssueTypes(definition);
  const inputs = createTaskInputs(definition);
  const prompts = createTaskPrompts(definition, templates);

  const state = lookup(
    definition.id,
    "state",
    definition.states.map((entry) => [entry.id, entry] as const),
  );
  const rolesById = new Map(definition.roles.map((role) => [role.id, role]));
  const role = lookup(definition.id, "role", rolesById);
  const artifactsById = new Map(definition.artifacts.map((artifact) => [artifact.id, artifact]));
  const eventsById = new Map(definition.events.map((event) => [event.id, event]));
  const event = lookup(definition.id, "event", eventsById);
  const effectEvents = new Map(
    definition.events.flatMap((entry) =>
      entry.effect !== undefined && entry.effect !== "status.set"
        ? [[entry.effect, entry.id] as const]
        : [],
    ),
  );
  const statusEvents = new Map(
    definition.events.flatMap((entry) => {
      const target = entry.outcomes[0]?.to;
      return entry.effect === "status.set" && target ? [[target, entry.id] as const] : [];
    }),
  );
  const agentSteps = definition.steps.filter((step): step is AgentStep => step.kind === "agent");
  const stepByRole = new Map(agentSteps.map((step) => [step.roleId, step]));
  if (stepByRole.size !== agentSteps.length) {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Task workflow "${definition.id}" gives a role two agent steps. Give each role one agent step.`,
    );
  }
  const launchAction = lookup(
    definition.id,
    "launch action",
    agentSteps.flatMap((step) =>
      step.launchActions.map((launch) => [launch.id, { ...launch, role: step.roleId }] as const),
    ),
  );
  const automation = lookup(
    definition.id,
    "automation",
    definition.automations.map((entry) => {
      const launch = launchAction(entry.launchActionId);
      const startMode = entry.startMode ?? launch.defaultStartMode;
      return [entry.id, { ...entry, role: launch.role, startMode }] as const;
    }),
  );
  const terminalStates = definition.states.filter(({ terminal }) => terminal).map(({ id }) => id);
  const terminalStateSet = new Set(terminalStates);

  const agentWorkflowsOf = (input: Parameters<Workflow["steps"]>[0]): AgentWorkflows => {
    const steps = new Map(evaluator.steps(input).map((step) => [step.id, step]));
    return Object.fromEntries(
      agentSteps.map((step): [string, AgentWorkflowState] => {
        const projection = steps.get(step.id);
        if (!projection)
          throw new Error(`Task workflow "${definition.id}" lost step "${step.id}".`);
        return [
          step.roleId,
          {
            required: projection.required,
            canSkip: !projection.required,
            available: projection.available,
            completed: projection.completed,
          },
        ];
      }),
    );
  };
  const project = inputs.cached((input): TaskProjection =>
    deepFreeze({
      availableActions: evaluator.availableActions(input),
      agentWorkflows: agentWorkflowsOf(input),
    }),
  );

  const allowedStatuses = (eventId: string, task: TaskFacts): string[] => {
    const input = inputs.input(task);
    return event(eventId).from.filter((status) =>
      evaluator.isEventAvailable({ ...input, state: status }, eventId),
    );
  };
  const notifications = new Map(
    definition.states.flatMap(({ id, notification }) =>
      notification ? [[id, notification] as const] : [],
    ),
  );

  return {
    definition,
    prompts,
    issueTypes,
    initialState: definition.initialState,
    terminalStates,
    reviewArtifactCodes: definition.artifacts
      .filter(({ kind }) => kind === "review")
      .map(({ id }) => id),
    worktreeRoles: definition.roles
      .filter(({ location }) => location === "task_worktree")
      .map(({ id }) => id),
    isTerminalState: (status) => terminalStateSet.has(status),
    state,
    role,
    hasRole: (roleId) => rolesById.has(roleId),
    artifact: (code) => artifactsById.get(code),
    artifactSubmitEvent: (code, verdict) => {
      const artifact = artifactsById.get(code);
      if (artifact?.kind === "review") {
        return artifact.verdicts.find((candidate) => candidate.id === verdict)?.eventId;
      }
      return artifact?.saveEventId;
    },
    emptyArtifactSummary: inputs.emptyArtifactSummary,
    effectEvent: (effect) => effectEvents.get(effect),
    statusEvent: (status) => statusEvents.get(status),
    decide: (eventId, task) => {
      const decision = evaluator.decide(inputs.input(task), eventId);
      if (decision.kind === "unchanged") return { kind: "unchanged", status: task.status };
      if (decision.kind === "transition") {
        const cause: TransitionCause = {};
        if (decision.signal !== undefined) cause.signal = decision.signal;
        if (decision.sourceRole !== undefined) cause.sourceRole = decision.sourceRole;
        return { kind: "transition", from: task.status, to: decision.to, cause };
      }
      const denial: TaskEventDenial = {
        kind: "denied",
        status: task.status,
        allowedStatuses: allowedStatuses(eventId, task),
      };
      const guardMessage =
        decision.reason === "guard"
          ? event(eventId).guards.find(({ id }) => id === decision.guardId)?.message
          : undefined;
      if (guardMessage !== undefined) denial.guardMessage = guardMessage;
      return denial;
    },
    isEventAvailable: (eventId, task) => evaluator.isEventAvailable(inputs.input(task), eventId),
    eventSourceStates: (eventId) => event(eventId).from,
    project,
    launchAction,
    roleStartEvent: (roleId) => stepByRole.get(roleId)?.startEventId,
    startEventRole: (eventId) => agentSteps.find((step) => step.startEventId === eventId)?.roleId,
    automation,
    stateNotification: (status, sourceRole) => {
      const notification = notifications.get(status);
      if (!notification) return undefined;
      const preferredRole = sourceRole ?? notification.role;
      const result: TaskStateNotification = {
        kind: notification.kind,
        status: notification.status,
        navigation:
          notification.route === "kanban" ? { type: "kanban_task" } : { type: "agent_studio_task" },
      };
      if (preferredRole !== undefined) {
        result.preferredRole = preferredRole;
        if (result.navigation.type === "agent_studio_task") {
          result.navigation.preferredRole = preferredRole;
        }
      }
      return result;
    },
    notificationDefaults: () => workflowNotificationDefaults(definition),
  };
};
