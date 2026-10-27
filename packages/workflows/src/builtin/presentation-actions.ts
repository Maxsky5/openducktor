import type { BuiltinTaskCard } from "./task-card";
import { BUILTIN_ACTIONS, BUILTIN_STEPS, builtinWorkflow } from "./definition";
import { builtinTaskInput } from "./facts";
import { getSessionLaunchAction, resolveActionLaunchAction } from "./launch";
import { roleWorkflowForTask } from "./presentation-role-state";
import type { BuiltinActionId, BuiltinRoleId } from "./ids";

export type TaskWorkflowAction = Exclude<BuiltinActionId, "view_details">;

type BuiltinActionDefinition = (typeof BUILTIN_ACTIONS)[number];
type LaunchingAction = Extract<BuiltinActionDefinition, { launchActionIds: readonly string[] }>;
type SessionAction = Extract<BuiltinActionDefinition, { kind: "session" }>;
type SessionViewAction = Extract<BuiltinActionDefinition, { kind: "view"; stepId: string }>;

const isLaunchingAction = (action: BuiltinActionDefinition): action is LaunchingAction =>
  "launchActionIds" in action;
const isSessionAction = (action: BuiltinActionDefinition): action is SessionAction =>
  action.kind === "session";
const isSessionViewAction = (action: BuiltinActionDefinition): action is SessionViewAction =>
  action.kind === "view" && "stepId" in action;

export type AgentStudioWorkflowQuickAction = LaunchingAction["id"];
export type SessionRoleViewAction = SessionViewAction["id"];

/** Actions that start a session. Agent Studio offers them as quick actions. */
export const AGENT_STUDIO_SESSION_START_ACTIONS: readonly AgentStudioWorkflowQuickAction[] =
  BUILTIN_ACTIONS.filter(isLaunchingAction).map((action) => action.id);

export const SESSION_CREATING_ACTIONS: readonly TaskWorkflowAction[] = BUILTIN_ACTIONS.filter(
  isSessionAction,
).map((action) => action.id);

const roleByStep = new Map(BUILTIN_STEPS.map((step) => [step.id, step.roleId]));

/** View actions with a step open the latest session of the step role. */
const sessionViewActions = BUILTIN_ACTIONS.filter(isSessionViewAction).map((action) => {
  const role = roleByStep.get(action.stepId);
  if (role === undefined) throw new Error(`The built-in workflow has no step ${action.stepId}.`);
  return { role, action: action.id };
});

const viewActionForRole = (role: BuiltinRoleId): SessionRoleViewAction => {
  const entry = sessionViewActions.find((candidate) => candidate.role === role);
  if (!entry) throw new Error(`The built-in workflow has no session view action for ${role}.`);
  return entry.action;
};

export const SESSION_VIEW_ACTION_BY_ROLE = {
  spec: viewActionForRole("spec"),
  planner: viewActionForRole("planner"),
  build: viewActionForRole("build"),
  qa: viewActionForRole("qa"),
} satisfies Record<BuiltinRoleId, SessionRoleViewAction>;

export const SESSION_VIEW_ACTIONS: ReadonlySet<TaskWorkflowAction> = new Set<TaskWorkflowAction>(
  sessionViewActions.map((entry) => entry.action),
);

const roleByViewAction = new Map<string, BuiltinRoleId>(
  sessionViewActions.map((entry) => [entry.action, entry.role]),
);

export const sessionRoleForViewAction = (action: TaskWorkflowAction): BuiltinRoleId | undefined =>
  roleByViewAction.get(action);

type TaskCardActionState = {
  primaryAction: TaskWorkflowAction | null;
  secondaryActions: TaskWorkflowAction[];
  allActions: TaskWorkflowAction[];
};

type ResolveTaskCardActionsOptions = {
  include?: readonly TaskWorkflowAction[];
  hasActiveSession?: boolean;
  activeSessionRole?: BuiltinRoleId;
  historicalSessionRoles?: readonly BuiltinRoleId[];
  surface?: "agent_studio_quick_actions";
  /**
   * An available action that leads the actions. It also shows where the surface hides it
   * otherwise, as Close Task for a merged task on a Kanban card.
   */
  leadingAction?: TaskWorkflowAction;
};

type TaskActionLabelOptions = {
  surface?: "kanban" | "agent_studio";
};

export const resolveTaskCardActions = (
  task: BuiltinTaskCard,
  options: ResolveTaskCardActionsOptions = {},
): TaskCardActionState => {
  const enabled = filterEnabledActions(task, options);
  const input = builtinTaskInput(task);
  const orderedEnabled = options.leadingAction
    ? builtinWorkflow.orderActions(input, enabled, [options.leadingAction])
    : // With an active session, its view action and the other session views lead.
      options.hasActiveSession && options.activeSessionRole
      ? builtinWorkflow.orderActions(input, enabled, [
          viewActionForRole(options.activeSessionRole),
          ...SESSION_VIEW_ACTIONS,
        ])
      : builtinWorkflow.orderActions(input, enabled);
  const primaryAction = orderedEnabled[0] ?? null;

  return {
    primaryAction,
    secondaryActions: primaryAction
      ? orderedEnabled.filter((action) => action !== primaryAction)
      : orderedEnabled,
    allActions: orderedEnabled,
  };
};

export const taskActionLabel = (
  action: TaskWorkflowAction,
  task: BuiltinTaskCard,
  options: TaskActionLabelOptions = {},
): string => {
  const input = builtinTaskInput(task);
  const label = builtinWorkflow.actionLabel(input, action);
  // Agent Studio names the launch action that the default Builder label starts.
  if (
    action === "build_start" &&
    options.surface === "agent_studio" &&
    label === BUILD_START_LABEL
  ) {
    return getSessionLaunchAction(resolveActionLaunchAction("build_start", task)).label;
  }
  return label;
};

const BUILD_START_LABEL = BUILTIN_ACTIONS.find((action) => action.id === "build_start")?.label;

const DETAIL_ONLY_WORKFLOW_ACTIONS = new Set<TaskWorkflowAction>(["close_task", "remove_worktree"]);

const allowsIncludedAction = (
  action: TaskWorkflowAction,
  includeSet: Set<TaskWorkflowAction> | null,
): boolean => (includeSet ? includeSet.has(action) : true);

const stepIdByAction = new Map<string, string>(
  BUILTIN_ACTIONS.filter(isSessionAction).map((action) => [action.id, action.stepId]),
);

/** A session action is a quick action while its step is available or completed. */
const resolveAgentStudioQuickActionCandidates = (
  task: BuiltinTaskCard,
  options: ResolveTaskCardActionsOptions,
): TaskWorkflowAction[] => {
  const includeSet = options.include ? new Set(options.include) : null;
  return AGENT_STUDIO_SESSION_START_ACTIONS.filter((action) => {
    if (!allowsIncludedAction(action, includeSet)) return false;
    const stepId = stepIdByAction.get(action);
    const role = stepId === undefined ? undefined : roleByStep.get(stepId);
    if (role === undefined) return task.availableActions.includes(action);
    const workflow = roleWorkflowForTask(task, role);
    return workflow.available || workflow.completed;
  });
};

const filterEnabledActions = (
  task: BuiltinTaskCard,
  options: ResolveTaskCardActionsOptions,
): TaskWorkflowAction[] => {
  if (options.surface === "agent_studio_quick_actions") {
    return resolveAgentStudioQuickActionCandidates(task, options);
  }

  const includeSet = options.include ? new Set(options.include) : null;
  let enabled = task.availableActions.reduce<TaskWorkflowAction[]>((actions, action) => {
    if (isWorkflowAction(action) && (!includeSet || includeSet.has(action))) {
      actions.push(action);
    }
    return actions;
  }, []);

  if (!includeSet) {
    enabled = enabled.filter((action) => !DETAIL_ONLY_WORKFLOW_ACTIONS.has(action));
  }
  const { leadingAction } = options;
  if (
    leadingAction !== undefined &&
    task.availableActions.includes(leadingAction) &&
    !enabled.includes(leadingAction)
  ) {
    enabled.push(leadingAction);
  }

  if (options.hasActiveSession) {
    enabled = enabled.filter((action) => !SESSION_CREATING_ACTION_SET.has(action));
  }

  const historicalSessionViewActions = (options.historicalSessionRoles ?? [])
    .map(viewActionForRole)
    .filter((action) => allowsIncludedAction(action, includeSet));

  enabled = dedupeActions([...enabled, ...historicalSessionViewActions]);

  if (options.hasActiveSession && options.activeSessionRole) {
    const activeSessionViewAction = viewActionForRole(options.activeSessionRole);
    if (!includeSet || includeSet.has(activeSessionViewAction)) {
      enabled = dedupeActions([activeSessionViewAction, ...enabled]);
    }
  }

  return enabled;
};

const SESSION_CREATING_ACTION_SET: ReadonlySet<TaskWorkflowAction> = new Set(
  SESSION_CREATING_ACTIONS,
);

const isWorkflowAction = (
  action: BuiltinActionId,
): action is Exclude<BuiltinActionId, "view_details"> => action !== "view_details";

const dedupeActions = <T extends string>(actions: T[]): T[] => Array.from(new Set(actions));
