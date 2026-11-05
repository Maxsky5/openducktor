import {
  useTaskWorkflowContinuation,
  type ContinueTaskWorkflow,
  type TaskWorkflowContinuation,
} from "./task-workflow-continuation";
import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import { useSessionStartContext } from "../../sessions/start/use-session-start-context";
import type { GitBranch } from "@openducktor/contracts";
import {
  defaultSessionLaunchActionForRole,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
  taskPullRequestLaunch,
  launchSessionCommand,
} from "@openducktor/workflows";
import { useCallback, useMemo } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { SessionStartModalModel } from "../../sessions/start/session-start-modal-model";
import { isKanbanActiveTaskSession, toKanbanTaskSession } from "../board/kanban-task-activity";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import { resolvePreferredActiveSession } from "../board/session-target-resolution";
import type { HumanReviewFeedbackModalModel } from "./human-review-feedback-types";
import { useHumanReviewFeedback } from "./use-human-review-feedback";
import { buildReusableSessionOptions } from "../../sessions/start/session-start-reuse-options";
import {
  buildSessionStartModalRequest,
  type RunSessionStartWorkflow,
} from "../../sessions/start/session-start-orchestration";
import { useSessionStartModalRunner } from "../../sessions/start/use-session-start-modal-runner";
import type { SessionNavigationTarget } from "../../sessions/navigation/session-navigation-target";
import {
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "../../lib/agent-session-identity";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { RepoSettingsInput } from "../../types/session-slices";
import type { SessionStartFlowRequest } from "../../sessions/start/session-start-types";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

/** A task view that a task action opens. */
export type TaskViewTarget = Extract<SessionNavigationTarget, { kind: "task" | "task_session" }>;

/**
 * Opens a task view. `selected` names the repository when the user picked this exact session,
 * so the view can select it before the session list loads. The platform owns the route.
 */
export type OpenTaskView = (
  target: TaskViewTarget,
  selected?: { repoPath: string },
) => void | Promise<void>;

type UseTaskSessionStartFlowArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  favoriteState: SessionStartModalModel["favoriteState"];
  repoSettings: RepoSettingsInput | null;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  openTaskView: OpenTaskView;
  workspaceRepoPath: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  onBackgroundTransfer?: (attemptId: string) => void;
};

export type UseTaskSessionStartFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  isSessionStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  startSessionIntent: (
    intent: SessionStartFlowRequest,
    committedTask?: TaskCard,
  ) => Promise<SessionStartWorkflowResult | undefined>;
  onPullRequestGenerate: (taskId: string, launchActionId?: string) => Promise<string | undefined>;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onHumanFeedback: (
    taskId: string,
    eventId: string,
    continuation?: TaskWorkflowContinuation,
  ) => void;
  continueTaskWorkflow: ContinueTaskWorkflow;
  onLaunch: (taskId: string, launchActionId: string, committedTask?: TaskCard) => void;
};

const findLatestSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

const findPreferredSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary | null => {
  const matchingSessions = findSessionsByRoleForTask(sessions, taskId, role).filter(
    isKanbanActiveTaskSession,
  );
  if (matchingSessions.length === 0) {
    return null;
  }

  const preferredSession = resolvePreferredActiveSession(
    matchingSessions.map(toKanbanTaskSession),
    role,
  );

  if (!preferredSession) {
    return null;
  }

  return (
    matchingSessions.find((session) => matchesAgentSessionIdentity(session, preferredSession)) ??
    null
  );
};

const findSessionsByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary[] => {
  return sessions
    .filter((session) => session.taskId === taskId && session.role === role)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
};

/**
 * Starts and opens the sessions of task workflow actions. Each start shows the session start
 * choices first, then runs the workflow launch.
 */
export function useTaskSessionStartFlow({
  activeWorkspaceId,
  branches = [],
  favoriteState,
  repoSettings,
  tasks,
  sessions,
  openTaskView,
  workspaceRepoPath,
  runSessionStartWorkflow,
  onBackgroundTransfer,
}: UseTaskSessionStartFlowArgs): UseTaskSessionStartFlowResult {
  const { feedback, startupAttempts } = useClientConnection();
  const workflowScope = useMemo(
    () =>
      activeWorkspaceId && workspaceRepoPath
        ? { workspaceId: activeWorkspaceId, repoPath: workspaceRepoPath }
        : null,
    [activeWorkspaceId, workspaceRepoPath],
  );
  const isCurrentContext = useSessionStartContext(activeWorkspaceId);

  const { sessionStartModal, isSessionStarting, runSessionStartRequest } =
    useSessionStartModalRunner({
      workspaceId: activeWorkspaceId,
      scopeKey: activeWorkspaceId,
      branches,
      favoriteState,
      repoSettings,
      workspaceRepoPath,
      onBackgroundTransfer,
    });

  const openAgents = useCallback(
    (taskId: string, role: AgentRole): void => {
      if (!activeWorkspaceId) {
        throw new Error("No active workspace is selected.");
      }
      openTaskView({ kind: "task", workspaceId: activeWorkspaceId, taskId, role });
    },
    [activeWorkspaceId, openTaskView],
  );

  const openStartedSession = useCallback(
    (intent: SessionStartFlowRequest, session: AgentSessionIdentity): void | Promise<void> => {
      if (!activeWorkspaceId) {
        throw new Error("No active workspace is selected.");
      }
      return openTaskView({
        kind: "task_session",
        workspaceId: activeWorkspaceId,
        taskId: intent.taskId,
        role: intent.role,
        identity: toAgentSessionIdentity(session),
      });
    },
    [activeWorkspaceId, openTaskView],
  );
  const startSessionIntent = useCallback(
    async (
      intent: SessionStartFlowRequest,
      committedTask?: TaskCard,
    ): Promise<SessionStartWorkflowResult | undefined> => {
      const selectedTask = committedTask ?? tasks.find((task) => task.id === intent.taskId) ?? null;
      if (selectedTask && selectedTask.id !== intent.taskId)
        throw new Error("The committed task does not match this session request.");
      const taskSessions = sessions.filter((session) => session.taskId === intent.taskId);
      return runSessionStartRequest(
        buildSessionStartModalRequest({
          source: "task_action",
          kickoff:
            intent.postStartAction === "kickoff"
              ? { workspaceId: activeWorkspaceId, task: selectedTask, request: intent }
              : undefined,
          request: intent,
          selectedModel: null,
          taskSessions,
          selectedTask,
        }),
        async ({ decision, runInBackground, startupAttemptId }) => {
          const input: Parameters<typeof startKanbanSessionFlow>[0] = {
            startupAttemptId,
            workspaceId: activeWorkspaceId,
            request: intent,
            decision,
            startInBackground: runInBackground,
            isCurrent: isCurrentContext,
            tasks: committedTask
              ? [...tasks.filter((task) => task.id !== committedTask.id), committedTask]
              : tasks,
            runSessionStartWorkflow,
            openStartedSession: (request, session) => {
              const attempt = startupAttempts.getAttempt(startupAttemptId);
              if (
                isCurrentContext() &&
                attempt?.presentation === "dialog" &&
                attempt.status.phase === "ready"
              )
                return openStartedSession(request, session);
            },
          };
          const session = await startKanbanSessionFlow(input);
          return session;
        },
      );
    },
    [
      isCurrentContext,
      openStartedSession,
      runSessionStartWorkflow,
      runSessionStartRequest,
      sessions,
      tasks,
      activeWorkspaceId,
      startupAttempts,
    ],
  );

  const {
    modal: humanReviewFeedbackModal,
    open: openHumanReviewFeedback,
    openForTask: openHumanReviewFeedbackForTask,
  } = useHumanReviewFeedback({
    tasks,
    scope: workflowScope,
    feedback,
    sessions,
    startSession: startSessionIntent,
  });

  const onLaunch = useCallback(
    (taskId: string, launchActionId: string, committedTask?: TaskCard): void => {
      const task = committedTask ?? tasks.find((task) => task.id === taskId);
      if (!task) throw new Error("Task workflow is unavailable. Reload the task.");
      const launch = task.taskWorkflow.launchAction(launchActionId);
      if (launch.context === "human_feedback") {
        openHumanReviewFeedbackForTask(task, launchActionId);
        return;
      }
      const request: SessionStartFlowRequest = {
        taskId,
        role: launch.role,
        launchActionId,
        postStartAction: launchSessionCommand(launch),
      };
      void startSessionIntent(request, task).catch((cause) =>
        feedback.show("error", "Failed to start session", {
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    },
    [tasks, startSessionIntent, openHumanReviewFeedbackForTask, feedback],
  );

  const continueTaskWorkflow = useTaskWorkflowContinuation(workflowScope, onLaunch);

  const onPullRequestGenerate = useCallback(
    async (taskId: string, launchActionId?: string): Promise<string | undefined> => {
      const task = tasks.find((task) => task.id === taskId);
      if (!task) throw new Error("Task workflow is unavailable. Reload the task.");
      const launch = taskPullRequestLaunch(task, launchActionId);
      if (!launch) throw new Error(`Task "${taskId}" declares no pull request launch.`);
      const { role } = launch;
      const roleLabel = task.taskWorkflow.role(role).label;
      const builderSessions = findSessionsByRoleForTask(sessions, taskId, role);
      if (builderSessions.length === 0 && !launch.startModes.includes("fresh")) {
        throw new Error(
          `No ${roleLabel} session is available to fork or reuse for task "${taskId}".`,
        );
      }

      const session = await startSessionIntent({
        taskId,
        role,
        launchActionId: launch.id,
        initialSourceSession: builderSessions[0]
          ? toAgentSessionIdentity(builderSessions[0])
          : null,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: builderSessions,
          role,
          roleLabel: task.taskWorkflow.role(role).label,
        }),
        postStartAction: launchSessionCommand(launch),
      });
      return session?.externalSessionId;
    },
    [tasks, sessions, startSessionIntent],
  );

  const onOpenSession = useCallback(
    (taskId: string, role: AgentRole, options?: SessionTargetOptions): void => {
      if (options?.session) {
        try {
          if (!activeWorkspaceId || !workspaceRepoPath) {
            throw new Error("Select the task's workspace, then open the session again.");
          }
          openTaskView(
            {
              kind: "task_session",
              workspaceId: activeWorkspaceId,
              taskId,
              role,
              identity: toAgentSessionIdentity(options.session),
            },
            { repoPath: workspaceRepoPath },
          );
        } catch (error) {
          feedback.show("error", "Failed to open the session.", {
            description: error instanceof Error ? error.message : "Unknown error",
          });
        }
        return;
      }

      const preferredSessionByRole = findPreferredSessionByRoleForTask(sessions, taskId, role);
      const fallbackLatestSessionByRole = findLatestSessionByRoleForTask(sessions, taskId, role);
      const sessionToOpen = preferredSessionByRole ?? fallbackLatestSessionByRole;
      if (sessionToOpen) {
        const task = tasks.find((task) => task.id === taskId);
        if (!task) {
          feedback.show("error", "Failed to open the session.", {
            description: "Task workflow is unavailable. Reload the task.",
          });
          return;
        }
        openStartedSession(
          {
            taskId,
            role,
            launchActionId: defaultSessionLaunchActionForRole(role, task.taskWorkflow),
            postStartAction: "none",
          },
          sessionToOpen,
        );
        return;
      }

      openAgents(taskId, role);
    },
    [
      activeWorkspaceId,
      feedback,
      openTaskView,
      openAgents,
      openStartedSession,
      sessions,
      tasks,
      workspaceRepoPath,
    ],
  );

  const onHumanFeedback = useCallback(
    (taskId: string, eventId: string, continuation?: TaskWorkflowContinuation): void => {
      openHumanReviewFeedback(taskId, { kind: "event", eventId, continuation });
    },
    [openHumanReviewFeedback],
  );

  return {
    continueTaskWorkflow,
    humanReviewFeedbackModal,
    isSessionStarting,
    sessionStartModal,
    startSessionIntent,
    onLaunch,
    onPullRequestGenerate,
    onOpenSession,
    onHumanFeedback,
  };
}
