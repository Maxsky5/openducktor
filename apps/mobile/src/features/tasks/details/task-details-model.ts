import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { KanbanTaskSession } from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@openducktor/frontend-core/tasks/board/kanban-task-workflow";
import {
  resolveHistoricalSessionRoles,
  resolveSessionTargetOptions,
  type SessionTargetOptions,
} from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import {
  type TaskActionTone,
  taskActionIsDestructive,
  taskActionLabel,
  taskActionTone,
} from "@openducktor/frontend-core/tasks/board/task-action-presentation";
import { TASK_DETAILS_WORKFLOW_ACTIONS } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import {
  canonicalTargetBranch,
  INVALID_TASK_TARGET_BRANCH_LABEL,
  taskTargetBranchValidationError,
} from "@openducktor/frontend-core/lib/target-branch";
import { TASK_PULL_REQUEST_ACTION_LABELS } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import {
  resolveTaskActionDestination,
  taskActionSendsCommand,
} from "@/features/workflow/task-action-routing";
import type { ActionMenuItem } from "@/ui/action-menu";
import { TASK_ACTION_ICONS, taskActionRole } from "../presentation/task-action-paint";

/**
 * The target branch that the task record names, or null when it names none. The repository
 * default then applies, and only the host knows it.
 */
export const taskTargetBranchPresentation = (
  task: Pick<TaskCard, "targetBranch" | "targetBranchError">,
): { label: string; error: string | null } | null => {
  const error = taskTargetBranchValidationError(task.targetBranchError);
  if (error) return { label: INVALID_TASK_TARGET_BRANCH_LABEL, error };
  return task.targetBranch
    ? { label: canonicalTargetBranch(task.targetBranch), error: null }
    : null;
};

/**
 * The workflow documents that a task has, for the Artifacts row, such as "Spec and Plan". Null
 * when it has none, since the task can still have saved files.
 */
export const taskDocumentsSummary = (summary: TaskCard["artifactSummary"]): string | null => {
  const names = [
    summary.spec.has ? "Spec" : null,
    summary.plan.has ? "Plan" : null,
    summary.qaReport.has ? "QA report" : null,
  ].filter((name) => name !== null);
  if (names.length === 0) return null;
  if (names.length === 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

export type TaskDetailsAction = {
  action: TaskWorkflowAction;
  label: string;
  tone: TaskActionTone;
  destructive: boolean;
  /**
   * True for an action that opens a session the view cannot find yet, as on the board card. The
   * session history can still load or have failed.
   */
  disabled: boolean;
};

export type TaskDetailsActions = {
  primary: TaskDetailsAction | null;
  others: TaskDetailsAction[];
  sessionOptionsOf: (role: AgentRole) => SessionTargetOptions | undefined;
};

/**
 * The workflow actions of task details, with the desktop rules: the host `availableActions`
 * decide which actions exist, and Close Task shows only here.
 */
export const resolveTaskDetailsActions = ({
  task,
  taskSessions,
  historicalSessions,
  activeSessionRole,
}: {
  task: TaskCard;
  taskSessions: readonly KanbanTaskSession[];
  historicalSessions: readonly AgentSessionRecord[];
  activeSessionRole: AgentRole | undefined;
}): TaskDetailsActions => {
  const options: Parameters<typeof resolveTaskCardActions>[1] = {
    include: TASK_DETAILS_WORKFLOW_ACTIONS,
    hasActiveSession: activeSessionRole !== undefined,
    historicalSessionRoles: resolveHistoricalSessionRoles(historicalSessions),
  };
  if (activeSessionRole) options.activeSessionRole = activeSessionRole;
  const resolved = resolveTaskCardActions(task, options);
  const sessionOptionsOf = (role: AgentRole) =>
    resolveSessionTargetOptions(historicalSessions, taskSessions, role);
  const describe = (action: TaskWorkflowAction): TaskDetailsAction => ({
    action,
    label: taskActionLabel(action, task),
    tone: taskActionTone(action),
    destructive: taskActionIsDestructive(action),
    disabled:
      resolveTaskActionDestination(action, task.id, sessionOptionsOf)?.kind === "no_session",
  });
  return {
    primary: resolved.primaryAction ? describe(resolved.primaryAction) : null,
    others: resolved.secondaryActions.map(describe),
    sessionOptionsOf,
  };
};

/** What a choice of the task actions menu does. */
export type TaskDetailsMenuChoice =
  | { kind: "delete" }
  | { kind: "unlink_pull_request" }
  | { kind: "action"; action: TaskDetailsAction };

const ACTION_PREFIX = "action:";

/**
 * The task actions menu: the workflow actions after the prominent one, Unlink PR, and Delete. Edit
 * is a button of the view. Every item waits while the task belongs to another workspace than the
 * selected one.
 */
export const taskDetailsMenuItems = ({
  actions,
  enabled,
  showUnlink,
  unlinking,
}: {
  actions: TaskDetailsActions;
  enabled: boolean;
  showUnlink: boolean;
  unlinking: boolean;
}): ActionMenuItem[] => {
  const items: ActionMenuItem[] = [];
  for (const action of actions.others) {
    items.push({
      id: `${ACTION_PREFIX}${action.action}`,
      title: action.label,
      icon: TASK_ACTION_ICONS[action.action],
      role: taskActionRole(action.action) ?? undefined,
      destructive: action.destructive,
      disabled: !enabled || action.disabled,
      command: taskActionSendsCommand(action.action),
    });
  }
  if (showUnlink) {
    items.push({
      id: "unlink_pull_request",
      title: unlinking
        ? TASK_PULL_REQUEST_ACTION_LABELS.unlinking
        : TASK_PULL_REQUEST_ACTION_LABELS.unlink,
      icon: "unlink",
      disabled: !enabled || unlinking,
      command: true,
    });
  }
  items.push({
    id: "delete",
    title: "Delete Task",
    icon: "trash",
    destructive: true,
    disabled: !enabled,
    // Delete is a host command, so it follows the command gate as the confirmation does.
    command: true,
  });
  return items;
};

/** The choice of a menu item ID, or null for an ID that the menu no longer lists. */
export const taskDetailsMenuChoice = (
  id: string,
  actions: TaskDetailsActions,
): TaskDetailsMenuChoice | null => {
  if (id === "delete") return { kind: "delete" };
  if (id === "unlink_pull_request") return { kind: "unlink_pull_request" };
  const action = actions.others.find((entry) => `${ACTION_PREFIX}${entry.action}` === id);
  return action ? { kind: "action", action } : null;
};
