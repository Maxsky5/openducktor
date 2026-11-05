import type {
  AgentWorkflowState,
  WorkflowActionEmphasis,
  WorkflowActionSurface,
  WorkflowEventEffect,
} from "@openducktor/contracts";
import { TASK_CLOSED_STATE, workflowActionSurfaceSchema } from "@openducktor/contracts";
import { taskWorkflowInput, type ResolvedTaskCard } from "./task-workflow-view";
import type { TaskWorkflow } from "./task-workflow/task-workflow";

export type TaskWorkflowAction = string;

const ALL_SURFACES = workflowActionSurfaceSchema.options;
type WorkflowActionDefinition = TaskWorkflow["definition"]["actions"][number];

const actionSurfaces = (action: WorkflowActionDefinition): readonly WorkflowActionSurface[] =>
  action.surfaces ?? ALL_SURFACES;
/** Whether a surface shows the action. */
export const actionShowsOn = (
  action: WorkflowActionDefinition,
  surface: WorkflowActionSurface,
): boolean => actionSurfaces(action).includes(surface);
export const actionEmphasis = (action: WorkflowActionDefinition): WorkflowActionEmphasis =>
  action.emphasis ?? "neutral";

export const taskIssueType = (
  task: Pick<ResolvedTaskCard, "id" | "issueType" | "taskWorkflow">,
) => {
  const choice = task.taskWorkflow.definition.issueTypes.find(({ id }) => id === task.issueType);
  if (!choice)
    throw new Error(
      `Task "${task.id}" has unknown issue type "${task.issueType}". Reload its workflow.`,
    );
  return choice;
};

export const roleWorkflowForTask = (
  task: ResolvedTaskCard | null | undefined,
  role: string,
): AgentWorkflowState => {
  if (!task) return { required: false, canSkip: true, available: false, completed: false };
  const state = task.agentWorkflows[role];
  if (!state)
    throw new Error(
      `Task "${task.id}" has no agent step for role "${role}". Refresh its workflow.`,
    );
  return state;
};
export const isRoleAvailableForTask = (
  task: ResolvedTaskCard | null | undefined,
  role: string,
): boolean => roleWorkflowForTask(task, role).available;
export const taskHasSessionPage = (task: ResolvedTaskCard): boolean =>
  task.status !== TASK_CLOSED_STATE;
export const taskReviewRejection = (
  task: ResolvedTaskCard | null | undefined,
): { label: string; description: string } | null => {
  if (!task) return null;
  for (const artifact of task.taskWorkflow.definition.artifacts) {
    const state = task.artifactSummary[artifact.id];
    if (artifact.kind !== "review" || !state?.present) continue;
    const verdict = artifact.verdicts.find(({ id, passes }) => id === state.verdict && !passes);
    if (verdict)
      return {
        label: `${artifact.shortLabel ?? artifact.label} ${verdict.label}`,
        description: `${artifact.label}: ${verdict.label}.`,
      };
  }
  return null;
};
export const isReviewRejectedTask = (task: ResolvedTaskCard | null | undefined): boolean =>
  taskReviewRejection(task) !== null;
export const taskNeedsInput = (task: ResolvedTaskCard): boolean =>
  task.taskWorkflow.needsInput(taskWorkflowInput(task));

type ResolveTaskCardActionsOptions = {
  include?: readonly string[] | undefined;
  hasActiveSession?: boolean | undefined;
  activeSessionRole?: string | undefined;
  historicalSessionRoles?: readonly string[] | undefined;
  surface?: WorkflowActionSurface | undefined;
};
export const resolveTaskCardActions = (
  task: ResolvedTaskCard,
  options: ResolveTaskCardActionsOptions = {},
) => {
  const { evaluator } = task.taskWorkflow;
  const surface = options.surface ?? "kanban";
  const declared = task.taskWorkflow;
  const allowed = (id: string) =>
    (!options.include || options.include.includes(id)) &&
    actionShowsOn(declared.action(id), surface);
  const views = task.taskWorkflow.sessionViews;
  let enabled = task.availableActions.filter(allowed);
  if (options.hasActiveSession)
    enabled = enabled.filter((id) => declared.action(id).kind !== "session");
  enabled.push(
    ...views
      .filter(
        ({ action, role }) =>
          allowed(action) &&
          (options.historicalSessionRoles?.includes(role) || options.activeSessionRole === role),
      )
      .map(({ action }) => action),
  );
  const activeViews = views
    .filter(({ role }) => role === options.activeSessionRole)
    .map(({ action }) => action);
  const ahead = options.hasActiveSession
    ? [...activeViews, ...views.map(({ action }) => action)]
    : undefined;
  const ordered = evaluator.orderActions(taskWorkflowInput(task), [...new Set(enabled)], ahead);
  const primaryAction = ordered[0] ?? null;
  return { primaryAction, secondaryActions: ordered.slice(1), allActions: ordered };
};
export const taskActionLabel = (
  action: string,
  task: ResolvedTaskCard,
  options: { surface?: WorkflowActionSurface } = {},
): string => {
  const { evaluator } = task.taskWorkflow;
  const label = evaluator.actionLabel(taskWorkflowInput(task), action);
  const declaration = task.taskWorkflow.action(action);
  return options.surface === "studio" &&
    declaration.studioLabel !== undefined &&
    label === declaration.label
    ? declaration.studioLabel
    : label;
};

/** The command that a task action runs. The host still checks the action when it runs. */
export type TaskActionCommand =
  | { kind: "view"; target: "session"; role: string }
  | { kind: "view"; target: "task_details" | "worktree_cleanup" }
  | { kind: "session"; launchActionId: string }
  | {
      kind: "event";
      eventId: string;
      effect: WorkflowEventEffect | undefined;
      launchActionIds: readonly string[];
    };

export const resolveWorkflowAction = (
  task: ResolvedTaskCard,
  id: string,
  accessibleSessionRole?: string,
): TaskActionCommand => {
  const action = task.taskWorkflow.action(id);
  const sessionRole = task.taskWorkflow.viewActionRole(id);
  if (
    !task.availableActions.includes(id) &&
    !(sessionRole && sessionRole === accessibleSessionRole)
  )
    throw new Error(
      `Action "${action.label}" is unavailable for task "${task.id}". Reload the task and check its workflow.`,
    );
  if (action.kind === "view")
    return sessionRole
      ? { kind: "view", target: "session", role: sessionRole }
      : { kind: "view", target: action.target ?? "task_details" };
  if (action.kind === "session")
    return {
      kind: "session",
      launchActionId: task.taskWorkflow.evaluator.actionLaunchAction(taskWorkflowInput(task), id),
    };
  return {
    kind: "event",
    eventId: action.eventId,
    effect: task.taskWorkflow.actionEffect(action.id),
    launchActionIds: action.launchActionIds ?? [],
  };
};

/** The available event action of the task whose event runs the host effect, if any. */
export const taskEffectAction = (
  task: Pick<ResolvedTaskCard, "availableActions" | "taskWorkflow">,
  effect: WorkflowEventEffect,
): string | undefined =>
  task.taskWorkflow.effectActions(effect).find((id) => task.availableActions.includes(id));
/** Whether the task can run an available event action whose event has the host effect. */
export const taskEffectAvailable = (
  task: Pick<ResolvedTaskCard, "availableActions" | "taskWorkflow">,
  effect: WorkflowEventEffect,
): boolean => taskEffectAction(task, effect) !== undefined;
