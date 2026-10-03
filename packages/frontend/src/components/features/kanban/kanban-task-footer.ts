import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey, matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { KanbanTaskActivityState, KanbanTaskSession } from "./kanban-task-activity";
import { resolveTaskCardActions, type TaskWorkflowAction } from "./kanban-task-workflow";
import {
  resolveHistoricalSessionRoles,
  resolvePreferredActiveSession,
  resolveSessionTargetOptions,
  type SessionTargetOptions,
} from "./session-target-resolution";

export type WorkflowPendingState = {
  isSessionStarting: boolean;
  approvingTaskId: string | null;
  requestingChangesTaskId: string | null;
  resettingImplementationTaskId: string | null;
};

export type CardLayout = { contentRevision: string; hasSessionShortcuts: boolean };

export const getTaskFooter = ({
  task,
  taskSessions,
  historicalSessions,
  hasActiveSession,
  activeSessionRole,
  taskActivityState,
  pendingState,
}: FooterInputs): Footer => {
  const workflowOptions: Parameters<typeof resolveTaskCardActions>[1] = {
    include: TASK_CARD_WORKFLOW_ACTIONS,
    hasActiveSession,
    historicalSessionRoles: resolveHistoricalSessionRoles(historicalSessions),
  };
  if (activeSessionRole) workflowOptions.activeSessionRole = activeSessionRole;
  // Session shortcuts must not change which action the workflow picks first.
  const workflowActions = resolveTaskCardActions(task, workflowOptions);
  const sessions = SESSION_ACTIONS.map((descriptor) => ({
    ...descriptor,
    options: resolveSessionTargetOptions(historicalSessions, taskSessions, descriptor.role),
  }));
  const primarySession = sessions.find(
    (session) => session.action === workflowActions.primaryAction,
  );
  const shortcuts =
    task.status === "closed"
      ? []
      : sessions.flatMap((session) => {
          if (
            !session.options ||
            matchesAgentSessionIdentity(session.options.session, primarySession?.options?.session)
          )
            return [];
          return [{ ...session, options: session.options }];
        });
  const secondaryActions = workflowActions.secondaryActions.filter((action) => {
    const target = sessions.find((session) => session.action === action)?.options?.session;
    return (
      !matchesAgentSessionIdentity(target, primarySession?.options?.session) &&
      !shortcuts.some((session) => matchesAgentSessionIdentity(target, session.options.session))
    );
  });
  const disabledActions = workflowActions.allActions.filter((action) => {
    const session = sessions.find((entry) => entry.action === action);
    if (session) return !session.options;
    switch (action) {
      case "set_spec":
      case "set_plan":
      case "build_start":
      case "qa_start":
        return pendingState?.isSessionStarting ?? false;
      case "human_approve":
        return pendingState?.approvingTaskId === task.id;
      case "human_request_changes":
        return pendingState?.requestingChangesTaskId === task.id;
      case "reset_implementation":
        return pendingState?.resettingImplementationTaskId === task.id;
      default:
        return false;
    }
  });
  const primaryActiveSession =
    hasActiveSession && activeSessionRole
      ? resolvePreferredActiveSession(taskSessions, activeSessionRole)
      : null;
  const primarySessionIsWaitingInput =
    primaryActiveSession?.activityState === "waiting_input" ||
    (taskActivityState === "waiting_input" && hasActiveSession);

  return {
    sessions,
    shortcuts,
    actions: { ...workflowActions, secondaryActions },
    disabledActions,
    primaryActiveSession,
    primarySessionIsWaitingInput,
  };
};

export const getCardLayout = (inputs: FooterInputs): CardLayout => {
  const footer = getTaskFooter(inputs);
  const { task } = inputs;
  const contentRevision = JSON.stringify([
    task.updatedAt,
    task.title,
    task.status,
    task.issueType,
    task.priority,
    task.labels,
    task.subtaskIds,
    task.availableActions,
    task.pullRequest,
    task.sourceIssue,
    task.documentSummary.qaReport,
    inputs.hasActiveSession,
    inputs.activeSessionRole,
    inputs.taskActivityState,
    inputs.taskSessions.map((session) => [
      agentSessionIdentityKey(session),
      session.role,
      session.startedAt,
      session.activityState,
    ]),
    inputs.historicalSessions.map((session) => [
      agentSessionIdentityKey(session),
      session.role,
      session.startedAt,
    ]),
    footer.actions.primaryAction,
    footer.actions.secondaryActions,
    footer.disabledActions,
    footer.shortcuts.map((session) => [
      session.role,
      agentSessionIdentityKey(session.options.session),
    ]),
  ]);
  return { contentRevision, hasSessionShortcuts: footer.shortcuts.length > 0 };
};

type RoleSession = (typeof SESSION_ACTIONS)[number] & {
  options: ReturnType<typeof resolveSessionTargetOptions>;
};

type Footer = {
  sessions: RoleSession[];
  shortcuts: (RoleSession & { options: SessionTargetOptions })[];
  actions: ReturnType<typeof resolveTaskCardActions>;
  disabledActions: TaskWorkflowAction[];
  primaryActiveSession: KanbanTaskSession | null;
  primarySessionIsWaitingInput: boolean;
};

const TASK_CARD_WORKFLOW_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "open_spec",
  "open_planner",
  "qa_start",
  "build_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
];

const SESSION_ACTIONS = [
  { role: "spec", action: "open_spec", label: "Spec" },
  { role: "planner", action: "open_planner", label: "Planner" },
  { role: "build", action: "open_builder", label: "Builder" },
  { role: "qa", action: "open_qa", label: "QA" },
] as const;

type FooterInputs = {
  task: TaskCard;
  taskSessions: readonly KanbanTaskSession[];
  historicalSessions: readonly AgentSessionRecord[];
  hasActiveSession: boolean;
  activeSessionRole?: AgentRole | undefined;
  taskActivityState: KanbanTaskActivityState;
  pendingState?: WorkflowPendingState | undefined;
};
