import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import { firstScenario, kickoffPromptForScenario } from "./agents-page-constants";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";

type UseKanbanSessionStartFlowArgs = {
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  tasks: TaskCard[];
  sessions: AgentSessionState[];
  navigate: NavigateFunction;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
};

type UseKanbanSessionStartFlowResult = {
  sessionStartModal: SessionStartModalModel | null;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  openBuildAfterHumanRequestChanges: (taskId: string) => void;
};

export const findLatestSessionByRoleForTask = (
  sessions: AgentSessionState[],
  taskId: string,
  role: AgentRole,
): AgentSessionState | null => {
  return (
    sessions
      .filter((session) => session.taskId === taskId && session.role === role)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
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
  startAgentSession,
  sendAgentMessage,
  updateAgentSessionModel,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const [isStartingSession, setIsStartingSession] = useState(false);

  const {
    intent: sessionStartIntent,
    isOpen: isSessionStartModalOpen,
    selection: sessionStartSelection,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    repoSettings,
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
        postStartAction: intent.sendKickoff ? "kickoff" : "none",
      });
    },
    [openStartModal],
  );

  const closeSessionStartModal = useCallback((): void => {
    if (isStartingSession) {
      return;
    }
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
        sendKickoff: sessionStartIntent.postStartAction === "kickoff",
      };

      const selection = sessionStartSelection;
      void (async () => {
        setIsStartingSession(true);
        try {
          const sessionId = await startAgentSession({
            taskId: intent.taskId,
            role: intent.role,
            scenario: intent.scenario,
            selectedModel: selection,
            sendKickoff: false,
            startMode: intent.startMode,
            requireModelReady: true,
          });

          if (selection) {
            updateAgentSessionModel(sessionId, selection);
          }

          closeStartModal();

          if (startInBackground) {
            const roleLabel = AGENT_ROLE_LABELS[intent.role] ?? intent.role.toUpperCase();
            toast.success(`Started ${roleLabel} session in background for ${intent.taskId}.`, {
              duration: 10000,
              description: (
                <button
                  type="button"
                  className="w-fit cursor-pointer p-0 text-sm font-medium text-foreground underline underline-offset-2"
                  onClick={() => openSessionInAgentStudio(intent, sessionId)}
                >
                  Open in Agent Studio
                </button>
              ),
            });
          } else {
            openSessionInAgentStudio(intent, sessionId);
          }

          if (startInBackground || intent.sendKickoff) {
            const kickoffPromise = sendAgentMessage(
              sessionId,
              kickoffPromptForScenario(intent.role, intent.scenario, intent.taskId),
            );

            if (startInBackground) {
              void kickoffPromise.catch(() => {
                toast.error("Session started, but kickoff message failed.");
              });
            } else {
              try {
                await kickoffPromise;
              } catch {
                toast.error("Session started, but kickoff message failed.");
              }
            }
          }
        } catch {
          toast.error("Failed to start the session.");
        } finally {
          setIsStartingSession(false);
        }
      })();
    },
    [
      closeStartModal,
      openSessionInAgentStudio,
      sendAgentMessage,
      sessionStartIntent,
      sessionStartSelection,
      startAgentSession,
      updateAgentSessionModel,
    ],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "build",
        scenario: "build_implementation_start",
        startMode: "reuse_latest",
        sendKickoff: true,
      });
    },
    [openSessionStartModal],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = resolveKanbanPlanningStartPreference(tasks, taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        const latestSpecSession = findLatestSessionByRoleForTask(sessions, taskId, "spec");

        if (latestSpecSession) {
          openSessionInAgentStudio(
            {
              taskId,
              role: "spec",
              scenario: firstScenario("spec"),
              startMode: "reuse_latest",
              sendKickoff: false,
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
        sendKickoff: startPreference === "fresh",
      });
    },
    [openAgents, openSessionInAgentStudio, openSessionStartModal, sessions, tasks],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      openAgents(taskId, "build");
    },
    [openAgents],
  );

  const openBuildAfterHumanRequestChanges = useCallback(
    (taskId: string): void => {
      openSessionStartModal({
        taskId,
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse_latest",
        sendKickoff: true,
      });
    },
    [openSessionStartModal],
  );

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
      isSelectionCatalogLoading: isCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
      allowRunInBackground: true,
      backgroundConfirmLabel: "Run in background",
      isStarting: isStartingSession,
      onOpenChange: (nextOpen) => {
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
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
    isCatalogLoading,
    isSessionStartModalOpen,
    isStartingSession,
    modelGroups,
    modelOptions,
    sessionStartIntent,
    sessionStartSelection,
    variantOptions,
  ]);

  return {
    sessionStartModal,
    onDelegate,
    onPlan,
    onBuild,
    openBuildAfterHumanRequestChanges,
  };
}
