import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { Copy, History, PanelRightOpen, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  type KanbanTaskSession,
  toKanbanTaskActivityState,
} from "@/components/features/kanban/kanban-task-activity";
import {
  getTaskFooter,
  type WorkflowPendingState,
} from "@/components/features/kanban/kanban-task-footer";
import {
  SESSION_VIEW_ACTIONS,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import {
  compareActiveSessionForPrimary,
  type SessionTargetOptions,
} from "@/components/features/kanban/session-target-resolution";
import { TASK_ACTION_ICON, taskActionLabel } from "@/components/features/kanban/task-action-ui";
import type { WorkspaceSessionLiveState } from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
import { isAgentSessionActivityActive } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import { toAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  type SessionNavigationRead,
  sessionLiveFactsOf,
} from "@/state/read-models/session-navigation-read-model";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { PaletteRowAction } from "./command-palette-types";

export type TaskSessionTarget = { role: AgentRole; identity: AgentSessionIdentity };

export type PaletteTaskCommand =
  | { kind: "open_session"; session: TaskSessionTarget }
  | { kind: "workflow"; action: TaskWorkflowAction }
  | { kind: "edit" }
  | { kind: "details" }
  | { kind: "copy_id" }
  | { kind: "reset_task" }
  | { kind: "delete" };

/** A task action before the palette gives it a handler. */
export type PaletteTaskAction = Omit<PaletteRowAction, "run"> & { command: PaletteTaskCommand };

export type PaletteTaskView = {
  /** What Enter runs on the task row, or null until the saved sessions are known. */
  open: Extract<PaletteTaskCommand, { kind: "open_session" | "details" }> | null;
  /** Why the session actions and the next step are missing, or null when they are shown. */
  sessionsNote: string | null;
  /** The main action of the Kanban card, or null when Mod+Enter has nothing to run. */
  nextStep: TaskWorkflowAction | null;
  /** The task action list. */
  actions: PaletteTaskAction[];
  /** The session that a workflow action opens for each role. */
  sessionOptionsByRole: Partial<Record<AgentRole, SessionTargetOptions>>;
};

/** What a task row does: the target of Enter, the step of Mod+Enter, and its action list. */
export const buildPaletteTaskView = ({
  task,
  sessions,
  live,
  pendingState,
}: {
  task: TaskCard;
  sessions: TaskSessionsRead;
  live: WorkspaceSessionLiveState;
  pendingState?: WorkflowPendingState | undefined;
}): PaletteTaskView => {
  if (sessions?.status !== "ready") {
    return {
      open: null,
      sessionsNote:
        sessions?.status === "error"
          ? `Sessions could not load: ${sessions.message}`
          : "Loading sessions…",
      nextStep: null,
      actions: destructiveLast(taskActions(task)),
      sessionOptionsByRole: {},
    };
  }

  // A closed task has no session page, so it opens its details and lists no session actions.
  const records = task.status === "closed" ? [] : sessions.data;
  const liveSessions = liveTaskSessions(records, live);
  const footer = getTaskFooter({
    task,
    taskSessions: liveSessions,
    historicalSessions: records,
    hasActiveSession: liveSessions.length > 0,
    activeSessionRole: liveSessions[0]?.role,
    taskActivityState: toKanbanTaskActivityState(liveSessions),
    pendingState,
  });
  const { primaryAction, allActions } = footer.actions;
  const latest = latestTaskSession(liveSessions, records);
  const sessionOptionsByRole: PaletteTaskView["sessionOptionsByRole"] = {};
  const sessionActions: PaletteTaskAction[] = [];
  for (const { role, label, options } of footer.sessions) {
    if (!options) continue;
    sessionOptionsByRole[role] = options;
    const RoleIcon = AGENT_ROLE_ICONS[role];
    sessionActions.push({
      key: `session:${role}`,
      label: `Open ${label} session`,
      keywords: ["session", "chat"],
      icon: <RoleIcon />,
      destructive: false,
      disabled: false,
      command: { kind: "open_session", session: { role, identity: options.session } },
    });
  }
  const disabledActions = new Set(footer.disabledActions);
  // The session actions already open the session of each role.
  const workflowActions = allActions.flatMap((action): PaletteTaskAction[] =>
    SESSION_VIEW_ACTIONS.has(action)
      ? []
      : [workflowAction(task, action, disabledActions.has(action))],
  );
  const latestActions: PaletteTaskAction[] = latest
    ? [
        {
          key: "latest",
          label: "Open latest session",
          detail: AGENT_ROLE_LABELS[latest.role],
          keywords: ["session", "resume", "continue"],
          icon: <History />,
          destructive: false,
          disabled: false,
          command: { kind: "open_session", session: latest },
        },
      ]
    : [];

  return {
    open: latest ? { kind: "open_session", session: latest } : { kind: "details" },
    sessionsNote: null,
    nextStep:
      task.status !== "closed" && primaryAction && !disabledActions.has(primaryAction)
        ? primaryAction
        : null,
    actions: destructiveLast([
      ...latestActions,
      ...sessionActions,
      ...workflowActions,
      ...taskActions(task),
    ]),
    sessionOptionsByRole,
  };
};

type TaskSessionsRead = SessionNavigationRead<AgentSessionRecord[]> | undefined;

/** Live sessions of the task from a ready live stream, primary first as on the Kanban card. */
const liveTaskSessions = (
  records: readonly AgentSessionRecord[],
  live: WorkspaceSessionLiveState,
): KanbanTaskSession[] => {
  if (live.kind !== "ready") return [];
  return records
    .flatMap((record): KanbanTaskSession[] => {
      const { facts, statusFailure } = sessionLiveFactsOf(live, record);
      if (!facts || statusFailure !== null || !isAgentSessionActivityActive(facts.activityState)) {
        return [];
      }
      return [
        {
          ...toAgentSessionIdentity(record),
          role: record.role,
          startedAt: record.startedAt,
          activityState: facts.activityState,
        },
      ];
    })
    .sort(compareActiveSessionForPrimary);
};

/** The live session that started last, else the saved session of any role that started last. */
const latestTaskSession = (
  liveSessions: readonly KanbanTaskSession[],
  records: readonly AgentSessionRecord[],
): TaskSessionTarget | null => {
  let latestLive: KanbanTaskSession | null = null;
  for (const session of liveSessions) {
    if (!latestLive || (session.startedAt ?? "") > (latestLive.startedAt ?? "")) {
      latestLive = session;
    }
  }
  if (latestLive) {
    return { role: latestLive.role, identity: toAgentSessionIdentity(latestLive) };
  }
  let latestRecord: AgentSessionRecord | null = null;
  for (const record of records) {
    if (!latestRecord || record.startedAt > latestRecord.startedAt) latestRecord = record;
  }
  return latestRecord
    ? { role: latestRecord.role, identity: toAgentSessionIdentity(latestRecord) }
    : null;
};

/** Keep the order of each part and put the destructive actions at the end. */
const destructiveLast = (actions: PaletteTaskAction[]): PaletteTaskAction[] => [
  ...actions.filter((action) => !action.destructive),
  ...actions.filter((action) => action.destructive),
];

const workflowAction = (
  task: TaskCard,
  action: TaskWorkflowAction,
  disabled: boolean,
): PaletteTaskAction => ({
  key: `workflow:${action}`,
  label: taskActionLabel(action, task),
  keywords: ["workflow", "start", "run"],
  icon: TASK_ACTION_ICON[action],
  destructive: action === "reset_implementation",
  disabled,
  command: { kind: "workflow", action },
});

/** Actions that need no session data. */
const taskActions = (task: TaskCard): PaletteTaskAction[] => [
  {
    key: "edit",
    label: "Edit task",
    keywords: ["rename", "change", "update"],
    icon: <Pencil />,
    destructive: false,
    disabled: false,
    command: { kind: "edit" },
  },
  {
    key: "details",
    label: "Open task details",
    keywords: ["view", "show", "artifacts"],
    icon: <PanelRightOpen />,
    destructive: false,
    disabled: false,
    command: { kind: "details" },
  },
  {
    key: "copy-id",
    label: "Copy task ID",
    keywords: ["clipboard", task.id],
    icon: <Copy />,
    destructive: false,
    disabled: false,
    command: { kind: "copy_id" },
  },
  ...(task.availableActions.includes("reset_task")
    ? [
        {
          key: "reset-task",
          label: taskActionLabel("reset_task", task),
          keywords: ["reset", "restart", "clear"],
          icon: <RotateCcw />,
          destructive: true,
          disabled: false,
          command: { kind: "reset_task" },
        } satisfies PaletteTaskAction,
      ]
    : []),
  {
    key: "delete",
    label: "Delete task",
    keywords: ["remove", "trash"],
    icon: <Trash2 />,
    destructive: true,
    disabled: false,
    command: { kind: "delete" },
  },
];
