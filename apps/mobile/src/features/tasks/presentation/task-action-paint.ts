import type { WorkflowIcon } from "@openducktor/contracts";
import {
  type TaskWorkflowAction,
  type ResolvedTaskCard,
  workflowRoleIcon,
} from "@openducktor/workflows";
import type { IconName } from "@/ui/icon";

/**
 * The role of an action that starts a role session. The desktop shows the role icon on these
 * actions, in place of the action icon.
 */
const taskActionRole = (actionId: TaskWorkflowAction, task: ResolvedTaskCard): string | null => {
  const action = task.taskWorkflow.action(actionId);
  if (action.kind !== "session") return null;
  const step = task.workflowSteps.find(({ id }) => id === action.stepId);
  return step?.kind === "agent" ? step.roleId : null;
};
export const taskActionRoleIcon = (
  action: string,
  task: ResolvedTaskCard,
): WorkflowIcon | undefined => {
  const role = taskActionRole(action, task);
  return role ? workflowRoleIcon(task.taskWorkflow, role) : undefined;
};
export const taskActionIcon = (action: string, task: ResolvedTaskCard): IconName => {
  const hint = task.taskWorkflow.action(action).icon;
  return hint ? TASK_ACTION_ICONS[hint] : "arrow-right";
};

/** The icon of each workflow action, on its button and in the actions menu, after the desktop. */
const TASK_ACTION_ICONS = {
  specification: "file-pen",
  planning: "route",
  building: "hammer",
  quality: "search-check",
  agent: "bot",
  open: "square-arrow-out-up-right",
  reset: "rotate-ccw",
  complete: "circle-check-big",
  undo: "undo-2",
  remove_worktree: "folder-x",
  feature: "sparkles",
  bug: "bug",
  task: "list-todo",
} as const satisfies Record<WorkflowIcon, IconName>;
