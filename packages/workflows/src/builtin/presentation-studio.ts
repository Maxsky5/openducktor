import type { BuiltinTaskCard } from "./task-card";
import { BUILTIN_ACTIONS } from "./definition";
import {
  getSessionLaunchAction,
  resolveActionLaunchAction,
  SESSION_LAUNCH_ACTIONS,
} from "./launch";
import type { AgentStudioWorkflowQuickAction, TaskWorkflowAction } from "./presentation-actions";
import type { BuiltinLaunchActionId, BuiltinRoleId } from "./ids";

type WorkflowQuickActionDefinition = {
  role: BuiltinRoleId;
  resolveLaunchActionId: (task: BuiltinTaskCard) => BuiltinLaunchActionId;
  description: string;
  requiresHumanFeedback?: true;
};

/** The action starts the launch action that the workflow selects for the task. */
const quickAction = (
  action: AgentStudioWorkflowQuickAction,
  description: string,
): WorkflowQuickActionDefinition => {
  const definition = BUILTIN_ACTIONS.find((candidate) => candidate.id === action);
  const [firstLaunchActionId] =
    definition && "launchActionIds" in definition ? definition.launchActionIds : [];
  if (firstLaunchActionId === undefined)
    throw new Error(`The built-in action ${action} starts no session.`);
  const firstLaunchAction = getSessionLaunchAction(firstLaunchActionId);
  const result: WorkflowQuickActionDefinition = {
    role: firstLaunchAction.role,
    resolveLaunchActionId: (task) => resolveActionLaunchAction(action, task),
    description,
  };
  if (firstLaunchAction.context === "human_feedback") result.requiresHumanFeedback = true;
  return result;
};

export const WORKFLOW_QUICK_ACTIONS = {
  set_spec: quickAction("set_spec", "Open the start-session flow for the Spec workflow."),
  set_plan: quickAction("set_plan", "Open the start-session flow for the Planner workflow."),
  build_start: quickAction(
    "build_start",
    "Open the start-session flow for Builder implementation work.",
  ),
  qa_start: quickAction("qa_start", "Open the start-session flow for QA review."),
  human_request_changes: quickAction(
    "human_request_changes",
    "Collect human feedback, then open the Builder rework flow.",
  ),
} satisfies Record<AgentStudioWorkflowQuickAction, WorkflowQuickActionDefinition>;

export const assertAgentStudioWorkflowQuickAction = (
  action: TaskWorkflowAction,
): AgentStudioWorkflowQuickAction => {
  if (isAgentStudioWorkflowQuickAction(action)) {
    return action;
  }
  throw new Error(`Unsupported Agent Studio quick action workflow action: ${action}`);
};

export const canShowPullRequestWorkflowQuickAction = (task: BuiltinTaskCard): boolean =>
  task.status === "human_review";

export const orderAgentStudioQuickActions = <
  Option extends { launchActionId: BuiltinLaunchActionId },
>(
  task: BuiltinTaskCard,
  options: Option[],
  workflowActionOrder: readonly AgentStudioWorkflowQuickAction[],
): Option[] => {
  const orderedWorkflowLaunchActions = workflowActionOrder.map((action) =>
    WORKFLOW_QUICK_ACTIONS[action].resolveLaunchActionId(task),
  );

  const launchActionPriority = new Map(
    orderedWorkflowLaunchActions.map((launchActionId, index) => [launchActionId, index]),
  );
  if (task.status === "human_review") {
    // A linked pull request leads with human feedback; without one, with pull request work.
    const primaryContext = task.pullRequest !== undefined ? "human_feedback" : "pull_request";
    const primaryReviewLaunchAction = SESSION_LAUNCH_ACTIONS.find(
      (action) => action.context === primaryContext,
    );
    if (primaryReviewLaunchAction) launchActionPriority.set(primaryReviewLaunchAction.id, -1);
  }
  const fallbackPriority = launchActionPriority.size + 1;

  return options.toSorted((left, right) => {
    const leftPriority = launchActionPriority.get(left.launchActionId) ?? fallbackPriority;
    const rightPriority = launchActionPriority.get(right.launchActionId) ?? fallbackPriority;
    return leftPriority - rightPriority;
  });
};

const WORKFLOW_QUICK_ACTION_KEYS = new Set<string>(Object.keys(WORKFLOW_QUICK_ACTIONS));

const isAgentStudioWorkflowQuickAction = (
  action: TaskWorkflowAction,
): action is AgentStudioWorkflowQuickAction => WORKFLOW_QUICK_ACTION_KEYS.has(action);
