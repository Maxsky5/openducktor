import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { isQaRejectedTask } from "@openducktor/frontend-core/lib/task-qa";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import { getTaskFooter } from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import {
  ISSUE_TYPE_LABELS,
  getPriorityLabel,
} from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import type { TaskWorkflowAction } from "@openducktor/frontend-core/tasks/board/kanban-task-workflow";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import {
  type TaskActionTone,
  taskActionIsDestructive,
  taskActionLabel,
  taskActionTone,
  taskSessionStatusLabel,
} from "@openducktor/frontend-core/tasks/board/task-action-presentation";
import { toDisplayTaskLabels } from "@openducktor/frontend-core/tasks/presentation/task-labels";
import { AGENT_ROLE_LABELS } from "@openducktor/frontend-core/types/agent-role-labels";
import type { IconName } from "@/ui/icon-names";
import { TASK_ACTION_ICONS } from "../presentation/task-action-paint";

/** The most labels that a card shows before it counts the rest. */
const CARD_VISIBLE_LABEL_COUNT = 2;

/**
 * How the primary control looks, with the desktop rules: the next workflow step is violet, other
 * starts are outlined, a reset is rose, and the control of a live session is sky, or amber while
 * the session waits for input.
 */
type TaskCardPrimaryAppearance = "filled" | "outline" | "destructive" | "running" | "waiting";

export type TaskCardPrimary = {
  action: TaskWorkflowAction;
  label: string;
  icon: IconName;
  appearance: TaskCardPrimaryAppearance;
  disabled: boolean;
  /** The active session that the primary control opens, with its state label. */
  activeSession: { roleLabel: string; statusLabel: string; waitingInput: boolean } | null;
};

type TaskCardMenuItem = {
  id: TaskWorkflowAction;
  title: string;
  icon: IconName;
  destructive: boolean;
  disabled: boolean;
};

type TaskCardShortcut = {
  role: AgentRole;
  label: string;
  options: SessionTargetOptions;
};

/** The live session that the card shows in its status strip, such as "Builder running". */
export type TaskCardLiveSession = {
  role: AgentRole;
  label: string;
  waitingInput: boolean;
};

export type TaskCardModel = {
  title: string;
  taskId: string;
  visibleLabels: string[];
  hiddenLabels: string[];
  qaRejected: boolean;
  liveSession: TaskCardLiveSession | null;
  primary: TaskCardPrimary | null;
  menu: TaskCardMenuItem[];
  shortcuts: TaskCardShortcut[];
  /** The session of each role that a session action opens, when the task has one. */
  sessionOptionsByRole: Partial<Record<AgentRole, SessionTargetOptions>>;
  /** The accessible summary of the card. */
  accessibilityLabel: string;
};

export type TaskCardInputs = {
  task: TaskCard;
  taskSessions: readonly KanbanTaskSession[];
  historicalSessions: readonly AgentSessionRecord[];
  activeSessionRole: AgentRole | undefined;
  taskActivityState: KanbanTaskActivityState;
};

const PRIMARY_APPEARANCES = {
  prominent: "filled",
  neutral: "outline",
  destructive: "destructive",
  warning: "outline",
} as const satisfies Record<TaskActionTone, TaskCardPrimaryAppearance>;

const liveSessionLabel = (roleLabel: string, statusLabel: string, waitingInput: boolean): string =>
  waitingInput ? `${roleLabel} needs input` : `${roleLabel} ${statusLabel.toLowerCase()}`;

/**
 * What a board card shows. The workflow footer of frontend-core picks the primary action, the
 * menu actions, and the session shortcuts with the desktop rules. The host `availableActions` stay
 * the authority: the card shows no action that the host does not list.
 */
export const buildTaskCardModel = ({
  task,
  taskSessions,
  historicalSessions,
  activeSessionRole,
  taskActivityState,
}: TaskCardInputs): TaskCardModel => {
  // The active session context of the board names the role of the primary active session.
  const hasActiveSession = activeSessionRole !== undefined;
  const footer = getTaskFooter({
    task,
    taskSessions,
    historicalSessions,
    hasActiveSession,
    activeSessionRole,
    taskActivityState,
  });
  const disabled = new Set(footer.disabledActions);
  const closed = task.status === "closed";
  const activeSession = hasActiveSession ? footer.primaryActiveSession : null;
  const waitingInput = footer.primarySessionIsWaitingInput;
  const session = activeSession
    ? {
        roleLabel: AGENT_ROLE_LABELS[activeSession.role] ?? activeSession.role,
        statusLabel: taskSessionStatusLabel({
          session: activeSession,
          isWaitingInput: waitingInput,
        }),
        waitingInput,
      }
    : null;
  const liveSession: TaskCardLiveSession | null =
    activeSession && session
      ? {
          role: activeSession.role,
          label: liveSessionLabel(session.roleLabel, session.statusLabel, waitingInput),
          waitingInput,
        }
      : null;
  const primaryAction = closed ? null : footer.actions.primaryAction;
  let primary: TaskCardPrimary | null = null;
  if (primaryAction) {
    let appearance: TaskCardPrimaryAppearance = PRIMARY_APPEARANCES[taskActionTone(primaryAction)];
    if (session) appearance = session.waitingInput ? "waiting" : "running";
    primary = {
      action: primaryAction,
      label: taskActionLabel(primaryAction, task),
      icon: TASK_ACTION_ICONS[primaryAction],
      appearance,
      disabled: disabled.has(primaryAction),
      activeSession: session,
    };
  }
  const menu = closed
    ? []
    : footer.actions.secondaryActions.map((action) => ({
        id: action,
        title: taskActionLabel(action, task),
        icon: TASK_ACTION_ICONS[action],
        destructive: taskActionIsDestructive(action),
        disabled: disabled.has(action),
      }));
  const shortcuts = footer.shortcuts.map((shortcut) => ({
    role: shortcut.role,
    label: shortcut.label,
    options: shortcut.options,
  }));
  const sessionOptionsByRole: Partial<Record<AgentRole, SessionTargetOptions>> = {};
  for (const entry of footer.sessions) {
    if (entry.options) sessionOptionsByRole[entry.role] = entry.options;
  }
  const priority = getPriorityLabel(task.priority);
  const labels = toDisplayTaskLabels(task.labels);
  const qaRejected = isQaRejectedTask(task);
  const summary = [
    task.title,
    task.id,
    ISSUE_TYPE_LABELS[task.issueType],
    `Priority ${priority.label}, ${priority.hint}`,
    qaRejected ? "QA rejected" : null,
    labels.length > 0 ? `Labels ${labels.join(", ")}` : null,
    liveSession?.label ?? null,
  ].filter((part): part is string => part !== null);
  return {
    title: task.title,
    taskId: task.id,
    visibleLabels: labels.slice(0, CARD_VISIBLE_LABEL_COUNT),
    hiddenLabels: labels.slice(CARD_VISIBLE_LABEL_COUNT),
    qaRejected,
    liveSession,
    primary,
    menu,
    shortcuts,
    sessionOptionsByRole,
    accessibilityLabel: summary.join(", "),
  };
};
