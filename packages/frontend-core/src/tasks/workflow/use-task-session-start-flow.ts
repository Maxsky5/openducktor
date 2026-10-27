import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import { useSessionStartContext } from "../../sessions/start/use-session-start-context";
import { createSessionStartKickoffResolver } from "../../sessions/start/session-start-kickoff";
import type { GitBranch } from "@openducktor/contracts";
import {
  defaultSessionLaunchActionForRole,
  resolveSessionContinuationLaunchAction,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { SessionStartModalModel } from "../../sessions/start/session-start-modal-model";
import { isKanbanActiveTaskSession, toKanbanTaskSession } from "../board/kanban-task-activity";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import { resolvePreferredActiveSession } from "../board/session-target-resolution";
import { submitHumanReviewFeedback } from "./human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "./human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "./human-review-feedback-types";
import { useHumanReviewFeedbackController } from "./use-human-review-feedback-controller";
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
  ) => Promise<SessionStartWorkflowResult | undefined>;
  onPullRequestGenerate: (taskId: string) => Promise<string | undefined>;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
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
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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
  const queryClient = useQueryClient();
  const isCurrentContext = useSessionStartContext(activeWorkspaceId);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

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

  const {
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    openHumanReviewFeedback,
    setHumanReviewFeedbackState,
  } = useHumanReviewFeedbackController({
    createState: (taskId) => createHumanReviewFeedbackState(tasks, taskId),
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
    async (intent: SessionStartFlowRequest): Promise<SessionStartWorkflowResult | undefined> => {
      const selectedTask = tasks.find((task) => task.id === intent.taskId) ?? null;
      const taskSessions = sessions.filter((session) => session.taskId === intent.taskId);
      return runSessionStartRequest(
        buildSessionStartModalRequest({
          source: "task_action",
          resolveKickoffPrompt: createSessionStartKickoffResolver({
            queryClient,
            workspaceId: activeWorkspaceId,
            task: selectedTask,
            request: intent,
          }),
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
            tasks,
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
      queryClient,
      openStartedSession,
      runSessionStartWorkflow,
      runSessionStartRequest,
      sessions,
      tasks,
      activeWorkspaceId,
      startupAttempts,
    ],
  );

  const closeHumanReviewFeedbackModal = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }

    clearHumanReviewFeedback();
  }, [clearHumanReviewFeedback, isSubmittingHumanReviewFeedback]);

  const onPullRequestGenerate = useCallback(
    async (taskId: string): Promise<string | undefined> => {
      const builderSessions = findSessionsByRoleForTask(sessions, taskId, "build");
      if (builderSessions.length === 0) {
        throw new Error(`No Builder session is available to fork or reuse for task "${taskId}".`);
      }

      const session = await startSessionIntent({
        taskId,
        role: "build",
        launchActionId: "build_pull_request_generation",
        initialSourceSession: builderSessions[0]
          ? toAgentSessionIdentity(builderSessions[0])
          : null,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: builderSessions,
          role: "build",
        }),
        postStartAction: "kickoff",
      });
      return session?.externalSessionId;
    },
    [sessions, startSessionIntent],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "build",
        launchActionId: resolveSessionContinuationLaunchAction(
          "build",
          tasks.find((entry) => entry.id === taskId) ?? null,
        ),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent, tasks],
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
        openStartedSession(
          {
            taskId,
            role,
            launchActionId: defaultSessionLaunchActionForRole(role),
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
      workspaceRepoPath,
    ],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      void startSessionIntent({
        taskId,
        role,
        launchActionId: defaultSessionLaunchActionForRole(role),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      onOpenSession(taskId, "build");
    },
    [onOpenSession],
  );

  const onQaStart = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "qa",
        launchActionId: "qa_review",
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onQaOpen = useCallback(
    (taskId: string): void => {
      onOpenSession(taskId, "qa");
    },
    [onOpenSession],
  );

  const onHumanRequestChanges = useCallback(
    (taskId: string): void => {
      openHumanReviewFeedback(taskId);
    },
    [openHumanReviewFeedback],
  );

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      const result = await submitHumanReviewFeedback({
        feedback,
        state: humanReviewFeedbackState,
        builderSessions: findSessionsByRoleForTask(
          sessions,
          humanReviewFeedbackState.taskId,
          "build",
        ),
        startRequestChangesSession: (request) => {
          const input: Parameters<typeof startSessionIntent>[0] = {
            taskId: request.taskId,
            role: request.role,
            launchActionId: request.launchActionId,
            existingSessionOptions: request.existingSessionOptions,
            postStartAction: request.postStartAction,
            message: request.message,
            beforeStartAction: request.beforeStartAction,
          };
          if (request.initialStartMode) {
            input.initialStartMode = request.initialStartMode;
          }
          if (request.initialSourceSession !== undefined) {
            input.initialSourceSession = request.initialSourceSession;
          }
          return startSessionIntent(input);
        },
      });
      if (result.outcome === "started") {
        clearHumanReviewFeedback();
      }
    } catch (error) {
      feedback.show("error", "Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [clearHumanReviewFeedback, feedback, humanReviewFeedbackState, sessions, startSessionIntent]);

  const humanReviewFeedbackModal = useMemo<HumanReviewFeedbackModalModel | null>(() => {
    if (!humanReviewFeedbackState) {
      return null;
    }

    return buildHumanReviewFeedbackModalModel({
      state: humanReviewFeedbackState,
      isSubmitting: isSubmittingHumanReviewFeedback,
      onDismiss: closeHumanReviewFeedbackModal,
      onMessageChange: (message: string) => {
        setHumanReviewFeedbackState((current) => (current ? { ...current, message } : current));
      },
      onConfirm: confirmHumanReviewFeedback,
    });
  }, [
    closeHumanReviewFeedbackModal,
    confirmHumanReviewFeedback,
    humanReviewFeedbackState,
    isSubmittingHumanReviewFeedback,
    setHumanReviewFeedbackState,
  ]);

  return {
    humanReviewFeedbackModal,
    isSessionStarting,
    sessionStartModal,
    startSessionIntent,
    onPullRequestGenerate,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  };
}
