import type { WorkflowIcon } from "@openducktor/contracts";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { KanbanTaskSession } from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import {
  resolveTaskCardActions,
  taskActionLabel,
  type TaskWorkflowAction,
  type ResolvedTaskCard as TaskCard,
  type WorkflowRoleId as AgentRole,
} from "@openducktor/workflows";
import {
  resolveHistoricalSessionRoles,
  resolveSessionTargetOptions,
  type SessionTargetOptions,
} from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import {
  type TaskActionTone,
  taskActionIsDestructive,
  taskActionTone,
} from "@openducktor/frontend-core/tasks/board/task-action-presentation";
import { taskDetailsWorkflowActions } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import {
  canonicalTargetBranch,
  INVALID_TASK_TARGET_BRANCH_LABEL,
  taskTargetBranchValidationError,
} from "@openducktor/frontend-core/lib/target-branch";
import { TASK_PULL_REQUEST_ACTION_LABELS } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import {
  resolveTaskActionDestination,
  taskActionSendsCommand,
} from "@openducktor/frontend-core/tasks/workflow/task-action-destination";
import {
  type CoreTaskAction,
  coreTaskActions,
  REMOVE_WORKTREE_ACTION,
} from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import type { ActionMenuItem } from "@/ui/action-menu";
import {
  coreTaskActionIcon,
  taskActionIcon,
  taskActionRoleIcon,
} from "../presentation/task-action-paint";

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
export const taskDocumentsSummary = (task: TaskCard): string | null => {
  const names = task.taskWorkflow.definition.artifacts
    .filter((artifact) => task.artifactSummary[artifact.id]?.present)
    .map((artifact) => artifact.shortLabel ?? artifact.label);
  if (!names.length) return null;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

export type TaskDetailsAction = {
  action: TaskWorkflowAction;
  label: string;
  tone: TaskActionTone;
  destructive: boolean;
  command: boolean;
  icon: import("@/ui/icon-names").IconName;
  roleIconHint?: WorkflowIcon | undefined;
  /**
   * True for an action that opens a session the view cannot find yet, as on the board card. The
   * session history can still load or have failed.
   */
  disabled: boolean;
};

export type TaskDetailsActions = {
  primary: TaskDetailsAction | null;
  others: TaskDetailsAction[];
  /** Close Task and Reset Task, which OpenDucktor gives every task that is not closed. */
  core: readonly CoreTaskAction[];
  /** Remove Worktree: the task is closed and keeps its worktree or task branch. */
  removeWorktree: boolean;
  sessionOptionsOf: (role: AgentRole) => SessionTargetOptions | undefined;
};

/**
 * The actions of task details, with the desktop rules: the host `availableActions` decide which
 * workflow actions exist, and the core actions follow them.
 */
export const resolveTaskDetailsActions = ({
  task,
  taskSessions,
  historicalSessions,
  activeSessionRole,
  canRemoveWorktree,
}: {
  task: TaskCard;
  taskSessions: readonly KanbanTaskSession[];
  historicalSessions: readonly AgentSessionRecord[];
  activeSessionRole: AgentRole | undefined;
  /** A closed task still has its worktree or task branch. */
  canRemoveWorktree: boolean;
}): TaskDetailsActions => {
  const resolved = resolveTaskCardActions(task, {
    surface: "details",
    include: taskDetailsWorkflowActions(task),
    hasActiveSession: activeSessionRole !== undefined,
    historicalSessionRoles: resolveHistoricalSessionRoles(historicalSessions),
    activeSessionRole,
  });
  const sessionOptionsOf = (role: AgentRole) =>
    resolveSessionTargetOptions(historicalSessions, taskSessions, role);
  const describe = (action: TaskWorkflowAction): TaskDetailsAction => ({
    action,
    label: taskActionLabel(action, task),
    tone: taskActionTone(action, task),
    destructive: taskActionIsDestructive(action, task),
    command: taskActionSendsCommand(task, action),
    icon: taskActionIcon(action, task),
    roleIconHint: taskActionRoleIcon(action, task),
    disabled: resolveTaskActionDestination(task, action, sessionOptionsOf).kind === "no_session",
  });
  return {
    primary: resolved.primaryAction ? describe(resolved.primaryAction) : null,
    others: resolved.secondaryActions.map(describe),
    core: coreTaskActions(task),
    removeWorktree: canRemoveWorktree,
    sessionOptionsOf,
  };
};

/** What a choice of the task actions menu does. */
export type TaskDetailsMenuChoice =
  | { kind: "delete" }
  | { kind: "unlink_pull_request" }
  | { kind: "action"; action: TaskDetailsAction }
  | { kind: "core"; action: CoreTaskAction }
  | { kind: "remove_worktree" };

const ACTION_PREFIX = "action:";
const CORE_PREFIX = "core:";

/**
 * The task actions menu: the workflow actions after the prominent one, the core actions, Remove
 * Worktree, Unlink PR, and Delete. Edit is a button of the view. Every item waits while the task belongs to another
 * workspace than the selected one.
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
      icon: action.icon,
      role: action.roleIconHint,
      destructive: action.destructive,
      disabled: !enabled || action.disabled,
      command: action.command,
    });
  }
  for (const action of actions.core) {
    items.push({
      id: `${CORE_PREFIX}${action.id}`,
      title: action.label,
      icon: coreTaskActionIcon(action),
      destructive: action.emphasis === "destructive",
      disabled: !enabled,
      // The confirmation runs a host command.
      command: true,
    });
  }
  if (actions.removeWorktree) {
    items.push({
      id: REMOVE_WORKTREE_ACTION.id,
      title: REMOVE_WORKTREE_ACTION.label,
      icon: coreTaskActionIcon(REMOVE_WORKTREE_ACTION),
      destructive: true,
      disabled: !enabled,
      // The confirmation runs a host command.
      command: true,
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
  if (id === REMOVE_WORKTREE_ACTION.id && actions.removeWorktree)
    return { kind: "remove_worktree" };
  const core = actions.core.find((entry) => `${CORE_PREFIX}${entry.id}` === id);
  if (core) return { kind: "core", action: core };
  const action = actions.others.find((entry) => `${ACTION_PREFIX}${entry.action}` === id);
  return action ? { kind: "action", action } : null;
};
