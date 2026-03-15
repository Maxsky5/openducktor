import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { firstScenario, useSessionStartModalCoordinator } from "@/features/session-start";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import {
  buildHumanReviewFeedbackModalModel,
  confirmHumanReviewFeedbackFlow,
  createHumanReviewFeedbackState,
  type HumanReviewFeedbackState,
  type PendingHumanReviewHydration,
} from "./kanban-human-review-feedback";
import type {
  HumanReviewFeedbackModalModel,
  KanbanSessionStartIntent,
} from "./kanban-page-model-types";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

type UseKanbanSessionStartFlowArgs = {
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  tasks: TaskCard[];
  sessions: AgentSessionState[];
  navigate: NavigateFunction;
  loadAgentSessions: AgentStateContextValue["loadAgentSessions"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
};

type UseKanbanSessionStartFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

export const findLatestSessionByRoleForTask = (
  sessions: AgentSessionState[],
  taskId: string,
  role: AgentRole,
): AgentSessionState | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

export const findSessionsByRoleForTask = (
  sessions: AgentSessionState[],
  taskId: string,
  role: AgentRole,
): AgentSessionState[] => {
  return sessions
    .filter((session) => session.taskId === taskId && session.role === role)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

export const resolveKanbanPlanningStartPreference = (
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
  activeRepo,
  repoSettings,
  tasks,
  sessions,
  navigate,
  loadAgentSessions,
  humanRequestChangesTask,
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const roleLabels = AGENT_ROLE_LABELS as Record<AgentRole, string>;
  const tasksRef = useRef(tasks);
  const sessionsRef = useRef(sessions);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [sessionStartBeforeAction, setSessionStartBeforeAction] =
    useState<KanbanSessionStartIntent["beforeStartAction"]>();
  const [pendingHumanReviewHydration, setPendingHumanReviewHydration] =
    useState<PendingHumanReviewHydration | null>(null);
  const [humanReviewFeedbackState, setHumanReviewFeedbackState] =
    useState<HumanReviewFeedbackState | null>(null);
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  const {
    intent: sessionStartIntent,
    isOpen: isSessionStartModalOpen,
    selection: sessionStartSelection,
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles,
    supportsVariants,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    repoSettings,
  });

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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
        scenario: intent.scenario,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const openSessionStartModal = useCallback(
    (intent: KanbanSessionStartIntent): void => {
      openStartModal({
        source: "kanban",
        taskId: intent.taskId,
        role: intent.role,
        scenario: intent.scenario,
        startMode: intent.startMode,
        postStartAction: intent.postStartAction,
        ...(intent.message ? { message: intent.message } : {}),
      });
      setSessionStartBeforeAction(intent.beforeStartAction);
    },
    [openStartModal],
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
        scenario: session.scenario,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const closeSessionStartModal = useCallback((): void => {
    if (isStartingSession) {
      return;
    }
    setSessionStartBeforeAction(undefined);
    closeStartModal();
  }, [closeStartModal, isStartingSession]);

  const confirmSessionStart = useCallback(
    (startInBackground = false): void => {
      if (!sessionStartIntent) {
        return;
      }

      const intent: KanbanSessionStartIntent = {
        taskId: sessionStartIntent.taskId,
        role: sessionStartIntent.role,
        scenario: sessionStartIntent.scenario,
        startMode: sessionStartIntent.startMode,
        postStartAction: sessionStartIntent.postStartAction,
        ...(sessionStartIntent.message ? { message: sessionStartIntent.message } : {}),
        ...(sessionStartBeforeAction ? { beforeStartAction: sessionStartBeforeAction } : {}),
      };

      const selection = sessionStartSelection;
      void (async () => {
        setIsStartingSession(true);
        try {
          await startKanbanSessionFlow({
            activeRepo,
            intent,
            selection,
            startInBackground,
            tasks,
            roleLabels,
            startAgentSession,
            updateAgentSessionModel,
            humanRequestChangesTask,
            closeStartModal,
            openSessionInAgentStudio,
            sendAgentMessage,
          });
        } catch {
          toast.error("Failed to start the session.");
        } finally {
          setIsStartingSession(false);
        }
      })();
    },
    [
      activeRepo,
      closeStartModal,
      openSessionInAgentStudio,
      sendAgentMessage,
      sessionStartIntent,
      sessionStartSelection,
      startAgentSession,
      tasks,
      humanRequestChangesTask,
      updateAgentSessionModel,
      sessionStartBeforeAction,
    ],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "build",
        scenario: "build_implementation_start",
        startMode: "reuse_latest",
        postStartAction: "kickoff",
      });
    },
    [openSessionStartModal],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const currentTasks = tasksRef.current;
      const currentSessions = sessionsRef.current;
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = resolveKanbanPlanningStartPreference(currentTasks, taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        const latestSpecSession = findLatestSessionByRoleForTask(currentSessions, taskId, "spec");

        if (latestSpecSession) {
          openSessionInAgentStudio(
            {
              taskId,
              role: "spec",
              scenario: firstScenario("spec"),
              startMode: "reuse_latest",
              postStartAction: "none",
            },
            latestSpecSession.sessionId,
          );
        } else {
          openAgents(taskId, "spec", firstScenario("spec"));
        }
        return;
      }

      openSessionStartModal({
        taskId,
        role,
        scenario: firstScenario(role),
        startMode: startPreference === "fresh" ? "fresh" : "reuse_latest",
        postStartAction: startPreference === "fresh" ? "kickoff" : "none",
      });
    },
    [openAgents, openSessionInAgentStudio, openSessionStartModal],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      openAgents(taskId, "build");
    },
    [openAgents],
  );

  const onQaStart = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "qa",
        scenario: "qa_review",
        startMode: "reuse_latest",
        postStartAction: "kickoff",
      });
    },
    [openSessionStartModal],
  );

  const onQaOpen = useCallback(
    (taskId: string): void => {
      const latestQaSession = findLatestSessionByRoleForTask(sessionsRef.current, taskId, "qa");

      if (latestQaSession) {
        openSessionInAgentStudio(
          {
            taskId,
            role: "qa",
            scenario: "qa_review",
            startMode: "reuse_latest",
            postStartAction: "none",
          },
          latestQaSession.sessionId,
        );
        return;
      }

      openAgents(taskId, "qa", "qa_review");
    },
    [openAgents, openSessionInAgentStudio],
  );

  const onHumanRequestChanges = useCallback(
    (taskId: string): void => {
      void (async () => {
        try {
          const baselineSessions = sessionsRef.current;
          await loadAgentSessions(taskId);

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
    [loadAgentSessions],
  );

  const confirmHumanReviewFeedback = useCallback((): void => {
    if (!humanReviewFeedbackState) {
      return;
    }

    void (async () => {
      setIsSubmittingHumanReviewFeedback(true);
      try {
        await confirmHumanReviewFeedbackFlow({
          state: humanReviewFeedbackState,
          humanRequestChangesTask,
          loadAgentSessions,
          openSessionStartModal,
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
    })();
  }, [
    humanRequestChangesTask,
    humanReviewFeedbackState,
    loadAgentSessions,
    openAgentStudioSession,
    openSessionStartModal,
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

  const sessionStartModal = useMemo<SessionStartModalModel | null>(() => {
    if (!sessionStartIntent) {
      return null;
    }

    return {
      open: isSessionStartModalOpen,
      title: sessionStartIntent.title,
      description:
        sessionStartIntent.description ??
        "Choose agent, model, and variant before starting this session.",
      confirmLabel: "Start session",
      selectedModelSelection: sessionStartSelection,
      selectedRuntimeKind,
      runtimeOptions,
      supportsProfiles,
      supportsVariants,
      isSelectionCatalogLoading: isCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      onSelectRuntime: handleSelectRuntime,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
      allowRunInBackground: true,
      backgroundConfirmLabel: "Run in background",
      isStarting: isStartingSession,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) {
          closeSessionStartModal();
        }
      },
      onConfirm: confirmSessionStart,
    };
  }, [
    agentOptions,
    closeSessionStartModal,
    confirmSessionStart,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
    isCatalogLoading,
    isSessionStartModalOpen,
    isStartingSession,
    modelGroups,
    modelOptions,
    runtimeOptions,
    selectedRuntimeKind,
    sessionStartIntent,
    sessionStartSelection,
    supportsProfiles,
    supportsVariants,
    variantOptions,
  ]);

  return {
    humanReviewFeedbackModal,
    sessionStartModal,
    onDelegate,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  };
}
