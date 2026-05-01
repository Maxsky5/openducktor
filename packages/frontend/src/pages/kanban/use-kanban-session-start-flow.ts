import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { toKanbanSessionPresentationState } from "@/components/features/kanban/kanban-task-activity";
import { resolvePreferredActiveSession } from "@/components/features/kanban/session-target-resolution";
import { submitHumanReviewFeedback } from "@/features/human-review-feedback/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@/features/human-review-feedback/use-human-review-feedback-controller";
import {
  buildReusableSessionOptions,
  buildSessionStartModalRequest,
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  useSessionStartModalRunner,
} from "@/features/session-start";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
  type WorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import type {
  ActiveWorkspace,
  AgentStateContextValue,
  RepoSettingsInput,
} from "@/types/state-slices";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<AgentRole, string>;

type UseKanbanSessionStartFlowArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  navigate: NavigateFunction;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
};

type UseKanbanSessionStartFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  startSessionIntent: (intent: KanbanSessionStartIntent) => Promise<string | undefined>;
  onPullRequestGenerate: (taskId: string) => Promise<string | undefined>;
  onDelegate: (taskId: string) => void;
  onOpenSession: (
    taskId: string,
    role: AgentRole,
    options?: { externalSessionId?: string | null },
  ) => void;
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
): WorkflowAgentSessionSummary | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

const findPreferredSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): WorkflowAgentSessionSummary | null => {
  const matchingSessions = findSessionsByRoleForTask(sessions, taskId, role);
  if (matchingSessions.length === 0) {
    return null;
  }

  const preferredSession = resolvePreferredActiveSession(
    matchingSessions.map((session) => ({
      externalSessionId: session.externalSessionId,
      role: session.role,
      status: session.status,
      startedAt: session.startedAt,
      presentationState: toKanbanSessionPresentationState(session),
    })),
    role,
  );

  if (!preferredSession) {
    return null;
  }

  return (
    matchingSessions.find(
      (session) => session.externalSessionId === preferredSession.externalSessionId,
    ) ?? null
  );
};

const findSessionsByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): WorkflowAgentSessionSummary[] => {
  return sessions
    .filter(
      (session): session is WorkflowAgentSessionSummary =>
        isWorkflowAgentSessionSummary(session) &&
        session.taskId === taskId &&
        session.role === role,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

const resolveKanbanPlanningStartPreference = (
  tasks: TaskCard[],
  taskId: string,
  action: "set_spec" | "set_plan",
): "fresh" | "continue" => {
  if (action === "set_plan") {
    return "fresh";
  }
  const task = tasks.find((entry) => entry.id === taskId);
  return task?.status === "spec_ready" ? "continue" : "fresh";
};

export function useKanbanSessionStartFlow({
  activeWorkspace,
  branches = [],
  repoSettings,
  tasks,
  sessions,
  navigate,
  loadRepoSettings: _loadRepoSettings,
  bootstrapTaskSessions: _bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory: _hydrateRequestedTaskSessionHistory,
  loadAgentSessions: _loadAgentSessions,
  humanRequestChangesTask,
  setTaskTargetBranch,
  startAgentSession,
  sendAgentMessage,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const queryClient = useQueryClient();
  const tasksRef = useRef(tasks);
  const sessionsRef = useRef(sessions);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  const { sessionStartModal, runSessionStartRequest } = useSessionStartModalRunner({
    activeWorkspace,
    branches,
    repoSettings,
  });

  tasksRef.current = tasks;
  sessionsRef.current = sessions;

  const {
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    openHumanReviewFeedback,
    setHumanReviewFeedbackState,
  } = useHumanReviewFeedbackController({
    createState: (taskId) => createHumanReviewFeedbackState(tasksRef.current, taskId),
  });

  const openAgents = useCallback(
    (taskId: string, role: AgentRole): void => {
      const params = new URLSearchParams({
        task: taskId,
        agent: role,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const openSessionInAgentStudio = useCallback(
    (intent: KanbanSessionStartIntent, externalSessionId: string): void => {
      const params = new URLSearchParams({
        task: intent.taskId,
        session: externalSessionId,
        agent: intent.role,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const startSessionIntent = useCallback(
    async (intent: KanbanSessionStartIntent): Promise<string | undefined> => {
      const selectedTask = tasksRef.current.find((task) => task.id === intent.taskId) ?? null;
      const taskSessions = sessionsRef.current.filter(
        (session) => session.taskId === intent.taskId,
      );
      return runSessionStartRequest(
        buildSessionStartModalRequest({
          source: "kanban",
          request: intent,
          selectedModel: null,
          taskSessions,
          selectedTask,
        }),
        async ({ decision, runInBackground }) => {
          const externalSessionId = await startKanbanSessionFlow({
            activeWorkspace,
            request: intent,
            decision,
            startInBackground: runInBackground,
            tasks: tasksRef.current,
            roleLabels: ROLE_LABELS,
            queryClient,
            startAgentSession,
            humanRequestChangesTask,
            ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
            openSessionInAgentStudio,
            sendAgentMessage,
          });
          return externalSessionId;
        },
      );
    },
    [
      activeWorkspace,
      humanRequestChangesTask,
      openSessionInAgentStudio,
      queryClient,
      runSessionStartRequest,
      sendAgentMessage,
      setTaskTargetBranch,
      startAgentSession,
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
      const builderSessions = findSessionsByRoleForTask(sessionsRef.current, taskId, "build");
      if (builderSessions.length === 0) {
        throw new Error(`No Builder session is available to fork or reuse for task "${taskId}".`);
      }

      return startSessionIntent({
        taskId,
        role: "build",
        launchActionId: "build_pull_request_generation",
        initialSourceExternalSessionId: builderSessions[0]?.externalSessionId ?? null,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: builderSessions,
          role: "build",
        }),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "build",
        launchActionId: resolveBuildContinuationLaunchAction(
          tasksRef.current.find((entry) => entry.id === taskId) ?? null,
        ),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onOpenSession = useCallback(
    (taskId: string, role: AgentRole, options?: { externalSessionId?: string | null }): void => {
      if (options?.externalSessionId) {
        openSessionInAgentStudio(
          { taskId, role, launchActionId: firstLaunchAction(role), postStartAction: "none" },
          options.externalSessionId,
        );
        return;
      }

      const preferredSessionByRole = findPreferredSessionByRoleForTask(
        sessionsRef.current,
        taskId,
        role,
      );
      const fallbackLatestSessionByRole = findLatestSessionByRoleForTask(
        sessionsRef.current,
        taskId,
        role,
      );
      const sessionToOpen = preferredSessionByRole ?? fallbackLatestSessionByRole;
      if (sessionToOpen) {
        openSessionInAgentStudio(
          { taskId, role, launchActionId: firstLaunchAction(role), postStartAction: "none" },
          sessionToOpen.externalSessionId,
        );
        return;
      }

      openAgents(taskId, role);
    },
    [openAgents, openSessionInAgentStudio],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const currentTasks = tasksRef.current;
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = resolveKanbanPlanningStartPreference(currentTasks, taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        onOpenSession(taskId, "spec");
        return;
      }

      void startSessionIntent({
        taskId,
        role,
        launchActionId: firstLaunchAction(role),
        postStartAction: startPreference === "fresh" ? "kickoff" : "none",
      });
    },
    [onOpenSession, startSessionIntent],
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
        state: humanReviewFeedbackState,
        builderSessions: findSessionsByRoleForTask(
          sessionsRef.current,
          humanReviewFeedbackState.taskId,
          "build",
        ),
        startRequestChangesSession: (request) =>
          startSessionIntent({
            taskId: request.taskId,
            role: request.role,
            launchActionId: request.launchActionId,
            ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
            existingSessionOptions: request.existingSessionOptions,
            ...(request.initialSourceExternalSessionId !== undefined
              ? { initialSourceExternalSessionId: request.initialSourceExternalSessionId }
              : {}),
            postStartAction: request.postStartAction,
            message: request.message,
            beforeStartAction: request.beforeStartAction,
          }),
      });
      if (result.outcome === "started") {
        clearHumanReviewFeedback();
      }
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [clearHumanReviewFeedback, humanReviewFeedbackState, startSessionIntent]);

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
