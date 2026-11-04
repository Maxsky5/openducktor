import type {
  AgentRoleDefinition,
  CompiledAgentRoleDefinition,
  AgentSessionStartMode,
  IssueType,
  AgentWorkflowState,
  AgentWorkflows,
  CompiledWorkflowDefinition,
  NotificationKindSetting,
  TaskArtifactSummary,
  WorkflowDefinition,
  WorkflowReference,
  TaskWorkflowStepState,
  WorkflowInput,
  WorkflowEventEffect,
  WorkflowNotificationKind,
} from "@openducktor/contracts";
import { deepFreeze } from "../deep-freeze";
import {
  createWorkflow,
  WorkflowEvaluationError,
  type Workflow,
  type WorkflowPredicate,
} from "../evaluate";
import { workflowNotificationDefaults } from "../notification-defaults";
import { createTaskInputs, taskIssueTypes, type TaskFacts } from "./task-input";
import { createTaskPrompts, type PromptTemplate, type TaskPrompts } from "./task-prompts";

type Definition = CompiledWorkflowDefinition;
/** A catalog role as a workflow binds it: the role and what it may do in this workflow. */
export type TaskWorkflowRole = CompiledAgentRoleDefinition & Definition["roles"][number];
export type TaskWorkflowState = Definition["states"][number];
export type TaskWorkflowArtifact = Definition["artifacts"][number];
type AgentStep = Extract<Definition["steps"][number], { kind: "agent" }>;
export type TaskWorkflowAction = Definition["actions"][number];
export type TaskWorkflowAgentStep = AgentStep;
/** A launch action that shows as an extra control on a surface, with its owning step. */
export type TaskWorkflowSurfaceLaunch = {
  readonly launch: TaskWorkflowLaunchAction;
  readonly stepId: string;
  readonly show: WorkflowPredicate;
};
/** A view action that opens the latest session of its step role. */
export type TaskWorkflowSessionView = { action: string; role: string; label: string };
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
  readonly workflow: WorkflowReference;
  readonly workflowSteps: TaskWorkflowStepState[];
  readonly availableActions: string[];
  readonly agentWorkflows: AgentWorkflows;
};

export type TaskStateNotification = {
  kind: WorkflowNotificationKind;
  status: string;
  title: string;
  body: string;
  preferredRole?: string;
  navigation: { type: "kanban_task" } | { type: "agent_studio_task"; preferredRole?: string };
};

/**
 * The queries that the host and the clients run on one task workflow. Each query reads the
 * definition, so a new definition works without code changes.
 */
export type TaskWorkflow = {
  readonly definition: Definition;
  /** The ID and revision that identify the definition. */
  readonly reference: WorkflowReference;
  /** The compiled evaluator of the definition. */
  readonly evaluator: Workflow;
  readonly prompts: TaskPrompts;
  /** The catalog roles that the workflow binds, merged with their bindings, in binding order. */
  readonly roles: readonly TaskWorkflowRole[];
  /** The prompt templates of the workflow, without the system prompts of its roles. */
  readonly workflowTemplates: readonly PromptTemplate[];
  readonly issueTypes: readonly IssueType[];
  readonly initialState: string;
  /** The task states that end the task. */
  readonly terminalStates: readonly string[];
  /** The review artifacts. An implementation reset drops them. */
  readonly reviewArtifactCodes: readonly string[];
  /** Roles whose sessions run in the task worktree. */
  readonly worktreeRoles: readonly string[];
  usesWorktree(roleId: string): boolean;
  isTerminalState(status: string): boolean;
  /** Whether merge detection checks the task branch of a task in this state. */
  detectsMerge(status: string): boolean;
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
  /**
   * The launch that follows an event, selected in the state that the event gives. A client starts
   * that launch before the host commits the event, so a canceled start leaves the task unchanged.
   */
  launchAfterEvent(
    eventId: string,
    task: TaskFacts,
    launchActionIds: readonly string[],
  ): string | null;
  isEventAvailable(eventId: string, task: TaskFacts): boolean;
  eventSourceStates(eventId: string): readonly string[];
  /** Tasks with equal inputs share one frozen projection. */
  project(task: TaskFacts): TaskProjection;
  launchAction(launchActionId: string): TaskWorkflowLaunchAction;
  action(actionId: string): TaskWorkflowAction;
  /** The host effect of an event action, if any. */
  actionEffect(actionId: string): WorkflowEventEffect | undefined;
  /** The event actions whose event runs the host effect. */
  effectActions(effect: WorkflowEventEffect): readonly string[];
  /** The agent step of a role, if the workflow has one. */
  agentStep(roleId: string): TaskWorkflowAgentStep | undefined;
  /** The role whose session a view action with a step opens. */
  viewActionRole(actionId: string): string | undefined;
  readonly sessionViews: readonly TaskWorkflowSessionView[];
  surfaceLaunches(surface: "studio" | "git_conflict"): readonly TaskWorkflowSurfaceLaunch[];
  /** Whether a display rule of an agent step asks the user for input. */
  needsInput(input: WorkflowInput): boolean;
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

/** Builds the task workflow of a definition, its prompt templates, and the role catalog. */
export const createTaskWorkflow = (
  source: WorkflowDefinition,
  templates: readonly PromptTemplate[],
  roleCatalog: readonly AgentRoleDefinition[],
): TaskWorkflow => {
  const evaluator = createWorkflow(source);
  const { definition } = evaluator;
  const catalogRoles = new Map(roleCatalog.map((role) => [role.id, role]));
  const roles: readonly TaskWorkflowRole[] = deepFreeze(
    definition.roles.map((binding) => {
      const catalogRole = catalogRoles.get(binding.id);
      if (!catalogRole)
        throw new WorkflowEvaluationError(
          "invalid_definition",
          `Task workflow "${definition.id}" binds unknown role "${binding.id}". Add the role to the role catalog.`,
        );
      return { ...structuredClone(catalogRole), ...binding };
    }),
  );
  const issueTypes = taskIssueTypes(definition);
  const inputs = createTaskInputs(definition);
  const workflowTemplates = deepFreeze(structuredClone([...templates]));
  const prompts = createTaskPrompts(definition, workflowTemplates, roles);

  const state = lookup(
    definition.id,
    "state",
    definition.states.map((entry) => [entry.id, entry] as const),
  );
  const rolesById = new Map(roles.map((role) => [role.id, role]));
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
  const mergeDetectionStates = new Set(
    definition.states.filter(({ mergeDetection }) => mergeDetection).map(({ id }) => id),
  );
  const worktreeRoleSet = new Set(
    roles.filter(({ location }) => location === "task_worktree").map(({ id }) => id),
  );
  const action = lookup(
    definition.id,
    "action",
    definition.actions.map((entry) => [entry.id, entry] as const),
  );
  const actionEffects = new Map(
    definition.actions.flatMap((entry) => {
      const effect = entry.kind === "event" ? eventsById.get(entry.eventId)?.effect : undefined;
      return effect ? [[entry.id, effect] as const] : [];
    }),
  );
  const effectActions = new Map<WorkflowEventEffect, string[]>();
  for (const [actionId, effect] of actionEffects)
    effectActions.set(effect, [...(effectActions.get(effect) ?? []), actionId]);
  const stepsById = new Map(definition.steps.map((step) => [step.id, step]));
  const viewActionRoles = new Map(
    definition.actions.flatMap((entry) => {
      const step = entry.kind === "view" && entry.stepId ? stepsById.get(entry.stepId) : undefined;
      return step?.kind === "agent" ? [[entry.id, step.roleId] as const] : [];
    }),
  );
  const sessionViews = deepFreeze(
    [...viewActionRoles].map(([actionId, roleId]) => ({
      action: actionId,
      role: roleId,
      label: role(roleId).label,
    })),
  );
  const surfaceLaunches = (surface: "studio" | "git_conflict") =>
    agentSteps.flatMap((step) =>
      step.launchActions
        .filter((launch) => launch.surface === surface)
        .map((launch) => ({
          launch: launchAction(launch.id),
          stepId: step.id,
          show: evaluator.condition(launch.showWhen ?? true),
        })),
    );
  const needsInputRules = agentSteps.flatMap((step) =>
    (step.displayRules ?? [])
      .filter(({ attention }) => attention === "needs_input")
      .map(({ when }) => evaluator.condition(when)),
  );
  const launchesBySurface = {
    studio: surfaceLaunches("studio"),
    git_conflict: surfaceLaunches("git_conflict"),
  };

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
      workflow: { id: definition.id, revision: definition.revision },
      workflowSteps: evaluator
        .steps(input)
        .map(({ id, required, available, completed }) => ({ id, required, available, completed })),
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
    reference: deepFreeze({ id: definition.id, revision: definition.revision }),
    evaluator,
    prompts,
    roles,
    workflowTemplates,
    issueTypes,
    initialState: definition.initialState,
    terminalStates,
    reviewArtifactCodes: definition.artifacts
      .filter(({ kind }) => kind === "review")
      .map(({ id }) => id),
    worktreeRoles: [...worktreeRoleSet],
    isTerminalState: (status) => terminalStateSet.has(status),
    detectsMerge: (status) => mergeDetectionStates.has(status),
    usesWorktree: (roleId) => worktreeRoleSet.has(roleId),
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
    launchAfterEvent: (eventId, task, launchActionIds) => {
      const decision = evaluator.decide(inputs.input(task), eventId);
      if (decision.kind === "denied")
        throw new Error(
          `Event "${eventId}" is unavailable in state "${task.status}". Reload the task.`,
        );
      const status = decision.kind === "transition" ? decision.to : task.status;
      return evaluator.selectLaunchAction(inputs.input({ ...task, status }), launchActionIds);
    },
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
    action,
    actionEffect: (actionId) => actionEffects.get(actionId),
    effectActions: (effect) => effectActions.get(effect) ?? [],
    agentStep: (roleId) => stepByRole.get(roleId),
    viewActionRole: (actionId) => viewActionRoles.get(actionId),
    sessionViews,
    surfaceLaunches: (surface) => launchesBySurface[surface],
    needsInput: (input) => needsInputRules.some((test) => test(input)),
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
        title: notification.title,
        body: notification.body,
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
