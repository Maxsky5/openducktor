import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
  PendingHumanReviewHydration,
} from "@/features/human-review-feedback/human-review-feedback-types";
import {
  buildReusableSessionOptions,
  firstScenario,
  useSessionStartModalRunner,
} from "@/features/session-start";
import { resolveBuildContinuationScenario } from "@/lib/build-scenarios";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import { confirmHumanReviewFeedbackFlow } from "./kanban-human-review-feedback";
import type {
  KanbanResolvedSessionStartIntent,
  KanbanSessionStartIntent,
} from "./kanban-page-model-types";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<AgentRole, string>;

type UseKanbanSessionStartFlowArgs = {
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  tasks: TaskCard[];
  sessions: AgentSessionState[];
  navigate: NavigateFunction;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
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
  sessions: AgentSessionState[],
  taskId: string,
  role: AgentRole,
): AgentSessionState | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

const findSessionsByRoleForTask = (
  sessions: AgentSessionState[],
  taskId: string,
  role: AgentRole,
): AgentSessionState[] => {
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
  activeRepo,
  repoSettings,
  tasks,
  sessions,
  navigate,
  loadRepoSettings: _loadRepoSettings,
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  loadAgentSessions: _loadAgentSessions,
  humanRequestChangesTask,
  startAgentSession,
  sendAgentMessage,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const queryClient = useQueryClient();
  const tasksRef = useRef(tasks);
  const sessionsRef = useRef(sessions);
  const [pendingHumanReviewHydration, setPendingHumanReviewHydration] =
    useState<PendingHumanReviewHydration | null>(null);
  const [humanReviewFeedbackState, setHumanReviewFeedbackState] =
    useState<HumanReviewFeedbackState | null>(null);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  const { sessionStartModal, runSessionStartRequest } = useSessionStartModalRunner({
    activeRepo,
    repoSettings,
  });

  tasksRef.current = tasks;
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!pendingHumanReviewHydration) {
      return;
    }

    if (sessions === pendingHumanReviewHydration.baselineSessions) {
      return;
    }

    const { taskId } = pendingHumanReviewHydration;
    const builderSessions = findSessionsByRoleForTask(sessions, taskId, "build");
    setHumanReviewFeedbackState(createHumanReviewFeedbackState(tasks, taskId, builderSessions));
    setPendingHumanReviewHydration(null);
  }, [pendingHumanReviewHydration, sessions, tasks]);

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
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const startSessionIntent = useCallback(
    async (intent: KanbanSessionStartIntent): Promise<string | undefined> => {
      return runSessionStartRequest(
        {
          source: "kanban",
          taskId: intent.taskId,
          role: intent.role,
          scenario: intent.scenario,
          ...(intent.initialStartMode ? { initialStartMode: intent.initialStartMode } : {}),
          ...(intent.targetWorkingDirectory !== undefined
            ? { targetWorkingDirectory: intent.targetWorkingDirectory }
            : {}),
          ...(intent.sourceSessionId ? { initialSourceSessionId: intent.sourceSessionId } : {}),
          existingSessionOptions:
            intent.existingSessionOptions ??
            buildReusableSessionOptions({
              sessions: sessionsRef.current.filter((session) => session.taskId === intent.taskId),
              role: intent.role,
            }),
          postStartAction: intent.postStartAction,
          ...(intent.message ? { message: intent.message } : {}),
        },
        async ({ decision, runInBackground }) => {
          const resolvedIntent: KanbanResolvedSessionStartIntent = {
            taskId: intent.taskId,
            role: intent.role,
            scenario: intent.scenario,
            startMode: decision.startMode,
            postStartAction: intent.postStartAction,
            ...(intent.targetWorkingDirectory !== undefined
              ? { targetWorkingDirectory: intent.targetWorkingDirectory }
              : {}),
            ...(decision.startMode === "reuse" || decision.startMode === "fork"
              ? { sourceSessionId: decision.sourceSessionId }
              : {}),
            ...(intent.message ? { message: intent.message } : {}),
            ...(intent.beforeStartAction ? { beforeStartAction: intent.beforeStartAction } : {}),
          };

          const sessionId = await startKanbanSessionFlow({
            activeRepo,
            intent: resolvedIntent,
            selection: decision.startMode === "reuse" ? null : decision.selectedModel,
            startInBackground: runInBackground,
            tasks: tasksRef.current,
            roleLabels: ROLE_LABELS,
            queryClient,
            startAgentSession,
            humanRequestChangesTask,
            openSessionInAgentStudio,
            sendAgentMessage,
          });
          return sessionId;
        },
      );
    },
    [
      activeRepo,
      humanRequestChangesTask,
      openSessionInAgentStudio,
      queryClient,
      runSessionStartRequest,
      sendAgentMessage,
      startAgentSession,
    ],
  );

  const closeHumanReviewFeedbackModal = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }

    setHumanReviewFeedbackState(null);
  }, [isSubmittingHumanReviewFeedback]);

  const openAgentStudioSession = useCallback(
    (taskId: string, session: AgentSessionState): void => {
      const params = new URLSearchParams({
        task: taskId,
        session: session.sessionId,
        agent: session.role,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const onPullRequestGenerate = useCallback(
    async (taskId: string): Promise<string | undefined> => {
      const builderSessions = findSessionsByRoleForTask(sessionsRef.current, taskId, "build");
      if (builderSessions.length === 0) {
        throw new Error(`No Builder session is available to fork for task "${taskId}".`);
      }

      return startSessionIntent({
        taskId,
        role: "build",
        scenario: "build_pull_request_generation",
        sourceSessionId: builderSessions[0]?.sessionId ?? null,
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

      const latestSessionByRole = findLatestSessionByRoleForTask(sessionsRef.current, taskId, role);
      if (latestSessionByRole) {
        openSessionInAgentStudio(
          {
            taskId,
            role,
            scenario: latestSessionByRole.scenario,
            postStartAction: "none",
          },
          latestSessionByRole.sessionId,
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
      void (async () => {
        try {
          const baselineSessions = sessionsRef.current;
          await bootstrapTaskSessions(taskId);

          const currentTasks = tasksRef.current;
          const currentBuilderSessions = findSessionsByRoleForTask(
            sessionsRef.current,
            taskId,
            "build",
          );

          if (currentBuilderSessions.length > 0) {
            setHumanReviewFeedbackState(
              createHumanReviewFeedbackState(currentTasks, taskId, currentBuilderSessions),
            );
            return;
          }

          setPendingHumanReviewHydration({ taskId, baselineSessions });
        } catch {
          setPendingHumanReviewHydration(null);
        }
      })();
    },
    [bootstrapTaskSessions],
  );

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      await confirmHumanReviewFeedbackFlow({
        state: humanReviewFeedbackState,
        humanRequestChangesTask,
        hydrateRequestedTaskSessionHistory,
        openSessionStartModal: (intent) => {
          void startSessionIntent(intent);
        },
        openAgentStudioSession,
        sendAgentMessage,
        onDismiss: () => {
          setHumanReviewFeedbackState(null);
        },
      });
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [
    humanRequestChangesTask,
    humanReviewFeedbackState,
    hydrateRequestedTaskSessionHistory,
    openAgentStudioSession,
    startSessionIntent,
    sendAgentMessage,
  ]);

  const humanReviewFeedbackModal = useMemo<HumanReviewFeedbackModalModel | null>(() => {
    if (!humanReviewFeedbackState) {
      return null;
    }

    return buildHumanReviewFeedbackModalModel({
      state: humanReviewFeedbackState,
      isSubmitting: isSubmittingHumanReviewFeedback,
      onDismiss: closeHumanReviewFeedbackModal,
      onTargetChange: (selectedTarget: string) => {
        setHumanReviewFeedbackState((current: HumanReviewFeedbackState | null) =>
          current ? { ...current, selectedTarget } : current,
        );
      },
      onMessageChange: (message: string) => {
        setHumanReviewFeedbackState((current: HumanReviewFeedbackState | null) =>
          current ? { ...current, message } : current,
        );
      },
      onConfirm: confirmHumanReviewFeedback,
    });
  }, [
    closeHumanReviewFeedbackModal,
    confirmHumanReviewFeedback,
    humanReviewFeedbackState,
    isSubmittingHumanReviewFeedback,
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
