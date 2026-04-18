import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
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
  firstScenario,
  useSessionStartModalRunner,
} from "@/features/session-start";
import { resolveBuildContinuationScenario } from "@/lib/build-scenarios";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
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
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
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
): AgentSessionSummary | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

const findPreferredSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary | null => {
  const matchingSessions = findSessionsByRoleForTask(sessions, taskId, role);
  if (matchingSessions.length === 0) {
    return null;
  }

  const preferredSession = resolvePreferredActiveSession(
    matchingSessions.map((session) => ({
      sessionId: session.sessionId,
      role: session.role,
      scenario: session.scenario,
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
    matchingSessions.find((session) => session.sessionId === preferredSession.sessionId) ?? null
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

export const resolveKanbanBuildStartScenario = (
  tasks: TaskCard[],
  taskId: string,
): AgentScenario => {
  const task = tasks.find((entry) => entry.id === taskId);
  return resolveBuildContinuationScenario(task);
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
    (taskId: string, role: AgentRole, scenario?: AgentScenario): void => {
      const params = new URLSearchParams({
        task: taskId,
        agent: role,
      });
      if (scenario) {
        params.set("scenario", scenario);
      }
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const openSessionInAgentStudio = useCallback(
    (intent: KanbanSessionStartIntent, sessionId: string): void => {
      const params = new URLSearchParams({
        task: intent.taskId,
        session: sessionId,
        agent: intent.role,
      });
      if (intent.scenario) {
        params.set("scenario", intent.scenario);
      }
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const startSessionIntent = useCallback(
    async (intent: KanbanSessionStartIntent): Promise<string | undefined> => {
      const selectedTask = tasksRef.current.find((task) => task.id === intent.taskId) ?? null;
      return runSessionStartRequest(
        buildSessionStartModalRequest({
          source: "kanban",
          request: intent,
          selectedModel: null,
          taskSessions: sessionsRef.current,
          selectedTask,
        }),
        async ({ decision, runInBackground }) => {
          const sessionId = await startKanbanSessionFlow({
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
          return sessionId;
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
        scenario: "build_pull_request_generation",
        initialSourceSessionId: builderSessions[0]?.sessionId ?? null,
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
        scenario: resolveKanbanBuildStartScenario(tasksRef.current, taskId),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onOpenSession = useCallback(
    (
      taskId: string,
      role: AgentRole,
      options?: { sessionId?: string | null; scenario?: AgentScenario | null },
    ): void => {
      if (options?.sessionId) {
        const explicitSession = sessionsRef.current.find(
          (session) =>
            session.taskId === taskId &&
            session.role === role &&
            session.sessionId === options.sessionId,
        );

        openSessionInAgentStudio(
          {
            taskId,
            role,
            scenario: explicitSession?.scenario ?? options.scenario ?? firstScenario(role),
            postStartAction: "none",
          },
          options.sessionId,
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
          {
            taskId,
            role,
            scenario: sessionToOpen.scenario,
            postStartAction: "none",
          },
          sessionToOpen.sessionId,
        );
        return;
      }

      openAgents(taskId, role, options?.scenario ?? firstScenario(role));
    },
    [openAgents, openSessionInAgentStudio],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const currentTasks = tasksRef.current;
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = resolveKanbanPlanningStartPreference(currentTasks, taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        onOpenSession(taskId, "spec", { scenario: firstScenario("spec") });
        return;
      }

      void startSessionIntent({
        taskId,
        role,
        scenario: firstScenario(role),
        postStartAction: startPreference === "fresh" ? "kickoff" : "none",
      });
    },
    [onOpenSession, startSessionIntent],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      const task = tasksRef.current.find((entry) => entry.id === taskId);
      onOpenSession(taskId, "build", { scenario: resolveBuildContinuationScenario(task) });
    },
    [onOpenSession],
  );

  const onQaStart = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "qa",
        scenario: "qa_review",
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onQaOpen = useCallback(
    (taskId: string): void => {
      onOpenSession(taskId, "qa", { scenario: "qa_review" });
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
            scenario: request.scenario,
            ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
            existingSessionOptions: request.existingSessionOptions,
            ...(request.initialSourceSessionId
              ? { initialSourceSessionId: request.initialSourceSessionId }
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
