import type { TaskCard } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  defaultStartModeForScenario,
} from "@openducktor/core";
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
  useSessionStartModalCoordinator,
} from "@/features/session-start";
import { roleDefaultSelectionFor } from "@/features/session-start/session-start-selection";
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
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
};

type UseKanbanSessionStartFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  onPullRequestGenerate: (taskId: string) => Promise<void>;
  onDelegate: (taskId: string) => void;
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
  loadRepoSettings,
  bootstrapTaskSessions,
  hydrateRequestedTaskSessionHistory,
  loadAgentSessions: _loadAgentSessions,
  humanRequestChangesTask,
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const queryClient = useQueryClient();
  const roleLabels = AGENT_ROLE_LABELS as Record<AgentRole, string>;
  const tasksRef = useRef(tasks);
  const sessionsRef = useRef(sessions);
  const sessionStartIntentRef = useRef<KanbanSessionStartIntent | null>(null);
  const sessionStartSelectionRef = useRef<AgentModelSelection | null>(null);
  const sessionStartBeforeActionRef = useRef<
    KanbanSessionStartIntent["beforeStartAction"] | undefined
  >(undefined);
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
    availableStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionId,
    openStartModal,
    closeStartModal,
    handleSelectStartMode,
    handleSelectSourceSession,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    repoSettings,
  });

  tasksRef.current = tasks;
  sessionsRef.current = sessions;
  sessionStartIntentRef.current = sessionStartIntent
    ? {
        taskId: sessionStartIntent.taskId,
        role: sessionStartIntent.role,
        scenario: sessionStartIntent.scenario,
        postStartAction: sessionStartIntent.postStartAction,
        ...(sessionStartIntent.message ? { message: sessionStartIntent.message } : {}),
      }
    : null;
  sessionStartSelectionRef.current = sessionStartSelection;
  sessionStartBeforeActionRef.current = sessionStartBeforeAction;

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
        ...(intent.sourceSessionId ? { initialSourceSessionId: intent.sourceSessionId } : {}),
        existingSessionOptions:
          intent.existingSessionOptions ??
          buildReusableSessionOptions({
            sessions: sessionsRef.current.filter((session) => session.taskId === intent.taskId),
            role: intent.role,
          }),
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
    (
      input?:
        | boolean
        | {
            runInBackground?: boolean;
            startMode?: "fresh" | "reuse" | "fork";
            sourceSessionId?: string | null;
          },
    ): void => {
      const latestIntent = sessionStartIntentRef.current;
      if (!latestIntent) {
        return;
      }
      const runInBackground =
        typeof input === "boolean" ? input : (input?.runInBackground ?? false);
      const startMode =
        typeof input === "boolean"
          ? defaultStartModeForScenario(latestIntent.scenario)
          : (input?.startMode ?? defaultStartModeForScenario(latestIntent.scenario));
      const sourceSessionId = typeof input === "boolean" ? null : (input?.sourceSessionId ?? null);

      const intent: KanbanResolvedSessionStartIntent = {
        taskId: latestIntent.taskId,
        role: latestIntent.role,
        scenario: latestIntent.scenario,
        startMode,
        postStartAction: latestIntent.postStartAction,
        ...(sourceSessionId ? { sourceSessionId } : {}),
        ...(latestIntent.message ? { message: latestIntent.message } : {}),
        ...(sessionStartBeforeActionRef.current
          ? { beforeStartAction: sessionStartBeforeActionRef.current }
          : {}),
      };

      void (async () => {
        setIsStartingSession(true);
        try {
          const explicitSelection = sessionStartSelectionRef.current;
          let effectiveRepoSettings = repoSettings;
          if (!explicitSelection && !effectiveRepoSettings && activeRepo) {
            effectiveRepoSettings = await loadRepoSettings();
          }
          const selection =
            explicitSelection ?? roleDefaultSelectionFor(effectiveRepoSettings, intent.role);
          await startKanbanSessionFlow({
            activeRepo,
            intent,
            selection,
            startInBackground: runInBackground,
            tasks,
            sessions,
            roleLabels,
            queryClient,
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
      startAgentSession,
      tasks,
      sessions,
      humanRequestChangesTask,
      updateAgentSessionModel,
      repoSettings,
      loadRepoSettings,
      queryClient,
    ],
  );

  const onPullRequestGenerate = useCallback(
    async (taskId: string): Promise<void> => {
      const builderSessions = findSessionsByRoleForTask(sessionsRef.current, taskId, "build");
      if (builderSessions.length === 0) {
        throw new Error(`No Builder session is available to fork for task "${taskId}".`);
      }

      openSessionStartModal({
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
    [openSessionStartModal],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "build",
        scenario: resolveKanbanBuildStartScenario(tasksRef.current, taskId),
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
        postStartAction: startPreference === "fresh" ? "kickoff" : "none",
      });
    },
    [openAgents, openSessionInAgentStudio, openSessionStartModal],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      const task = tasksRef.current.find((entry) => entry.id === taskId);
      openAgents(taskId, "build", resolveBuildContinuationScenario(task));
    },
    [openAgents],
  );

  const onQaStart = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "qa",
        scenario: "qa_review",
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
          hydrateRequestedTaskSessionHistory,
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
    hydrateRequestedTaskSessionHistory,
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
        "Choose how to start the session, then pick the agent, model, and variant.",
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
      availableStartModes,
      selectedStartMode,
      existingSessionOptions,
      selectedSourceSessionId,
      onSelectStartMode: handleSelectStartMode,
      onSelectSourceSession: handleSelectSourceSession,
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
    handleSelectStartMode,
    handleSelectSourceSession,
    isCatalogLoading,
    isSessionStartModalOpen,
    isStartingSession,
    modelGroups,
    modelOptions,
    runtimeOptions,
    availableStartModes,
    existingSessionOptions,
    selectedSourceSessionId,
    selectedStartMode,
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
    onPullRequestGenerate,
    onDelegate,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  };
}
