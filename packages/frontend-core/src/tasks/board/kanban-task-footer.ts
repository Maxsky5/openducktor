import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  sessionViewActions,
  resolveTaskCardActions,
  taskHasSessionPage,
  type TaskWorkflowAction,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
} from "../../lib/agent-session-identity";
import type { KanbanTaskActivityState, KanbanTaskSession } from "./kanban-task-activity";
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
  mergedTarget,
  autoCloseFailure,
}: FooterInputs): Footer => {
  // A merged task proposes Close Task. Session shortcuts must not change which action leads.
  const proposesClose = mergedTarget !== undefined || autoCloseFailure !== undefined;
  const workflowActions = resolveTaskCardActions(task, {
    surface: "kanban",
    hasActiveSession,
    historicalSessionRoles: resolveHistoricalSessionRoles(historicalSessions),
    activeSessionRole: activeSessionRole || undefined,
    leadingAction: proposesClose ? task.taskWorkflow.effectActions("task.close")[0] : undefined,
  });
  const sessions = sessionViewActions(task).map((view) => ({
    ...view,
    options: resolveSessionTargetOptions(historicalSessions, taskSessions, view.role),
  }));
  const primarySession = sessions.find(
    (session) => session.action === workflowActions.primaryAction,
  );
  const shortcuts = !taskHasSessionPage(task)
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
    if (task.taskWorkflow.action(action).kind === "session")
      return pendingState?.isSessionStarting ?? false;
    switch (task.taskWorkflow.actionEffect(action)) {
      case "review.approve":
        return pendingState?.approvingTaskId === task.id;
      case "review.request_changes":
        return pendingState?.requestingChangesTaskId === task.id;
      case "implementation.reset":
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
    task.availableActions,
    task.pullRequest,
    task.sourceIssue,
    task.artifactSummary,
    inputs.hasActiveSession,
    inputs.activeSessionRole,
    inputs.taskActivityState,
    inputs.mergedTarget,
    inputs.autoCloseFailure,
    inputs.taskSessions.map((session) => [
      agentSessionIdentityKey(session),
      session.role,
      session.startedAt,
      session.activityState,
      session.statusUnavailableReason,
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

type RoleSession = { role: string; action: string; label: string } & {
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

type FooterInputs = {
  task: TaskCard;
  taskSessions: readonly KanbanTaskSession[];
  historicalSessions: readonly AgentSessionRecord[];
  hasActiveSession: boolean;
  activeSessionRole?: AgentRole | undefined;
  taskActivityState: KanbanTaskActivityState;
  pendingState?: WorkflowPendingState | undefined;
  /** The target that the task branch is merged into. */
  mergedTarget?: string | undefined;
  /** Why the pull request sync could not close the task. Close Task then leads. */
  autoCloseFailure?: string | undefined;
};
