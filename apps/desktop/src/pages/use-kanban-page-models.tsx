import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { type AgentRole, type AgentScenario, mapToKanbanColumns } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { useAgentState, useTasksState, useWorkspaceState } from "@/state";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { firstScenario, kickoffPromptForScenario } from "./agents-page-constants";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";

type KanbanSessionStartIntent = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  sendKickoff: boolean;
};

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  onCreateTask: () => void;
  onRefreshTasks: () => void;
};

export type KanbanPageContentModel = {
  columns: ReturnType<typeof mapToKanbanColumns>;
  runStateByTaskId: Map<string, RunSummary["state"]>;
  activeSessionsByTaskId: Map<string, AgentSessionState[]>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

export type KanbanPageTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  onOpenChange: (open: boolean) => void;
};

export type KanbanPageDetailsSheetModel = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onEdit: (taskId: string) => void;
  onDefer: (taskId: string) => void;
  onResumeDeferred: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  taskComposer: KanbanPageTaskComposerModel;
  detailsSheet: KanbanPageDetailsSheetModel;
  sessionStartModal: SessionStartModalModel | null;
};

const ROLE_LABEL_BY_ROLE: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Build",
  qa: "QA",
};

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

export function useKanbanPageModels(): KanbanPageModels {
  const { activeRepo, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const { sessions, startAgentSession, sendAgentMessage, updateAgentSessionModel } =
    useAgentState();
  const {
    tasks,
    runs,
    refreshTasks,
    isLoadingTasks,
    deleteTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTasksState();
  const navigate = useNavigate();

  const [isTaskComposerOpen, setTaskComposerOpen] = useState(false);
  const [composerTaskId, setComposerTaskId] = useState<string | null>(null);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);

  const { repoSettings } = useAgentStudioRepoSettings({
    activeRepo,
    loadRepoSettings,
  });

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

  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);

  const runStateByTaskId = useMemo(
    () => new Map(runs.map((run) => [run.taskId, run.state])),
    [runs],
  );

  const activeSessionsByTaskId = useMemo(() => {
    const sessionsByTaskId = new Map<string, AgentSessionState[]>();
    for (const session of sessions) {
      if (!ACTIVE_SESSION_STATUS.has(session.status)) {
        continue;
      }

      const existing = sessionsByTaskId.get(session.taskId);
      if (existing) {
        existing.push(session);
      } else {
        sessionsByTaskId.set(session.taskId, [session]);
      }
    }

    for (const taskSessions of sessionsByTaskId.values()) {
      taskSessions.sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "running" ? -1 : 1;
        }
        return right.startedAt.localeCompare(left.startedAt);
      });
    }

    return sessionsByTaskId;
  }, [sessions]);

  const detailsTask = useMemo(
    () => tasks.find((task) => task.id === detailsTaskId) ?? null,
    [detailsTaskId, tasks],
  );

  const composerTask = useMemo(
    () => tasks.find((task) => task.id === composerTaskId) ?? null,
    [composerTaskId, tasks],
  );

  const openAgents = useCallback(
    (taskId: string, agent: AgentRole, scenario?: AgentScenario) => {
      const params = new URLSearchParams({
        task: taskId,
        agent,
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

  const handleOpenSessionStart = useCallback(
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
            const roleLabel = ROLE_LABEL_BY_ROLE[intent.role] ?? intent.role.toUpperCase();
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

  const handleDelegate = useCallback(
    (taskId: string): void => {
      handleOpenSessionStart({
        taskId,
        role: "build",
        scenario: "build_implementation_start",
        startMode: "reuse_latest",
        sendKickoff: true,
      });
    },
    [handleOpenSessionStart],
  );

  const getPlanningStartPreference = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): "fresh" | "continue" => {
      if (action === "set_plan") {
        return "fresh";
      }
      const task = tasks.find((entry) => entry.id === taskId);
      return task?.status === "spec_ready" ? "continue" : "fresh";
    },
    [tasks],
  );

  const handlePlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = getPlanningStartPreference(taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        const latestSpecSession =
          sessions
            .filter((session) => session.taskId === taskId && session.role === "spec")
            .sort((a, b) =>
              a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
            )[0] ?? null;

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

      handleOpenSessionStart({
        taskId,
        role,
        scenario: firstScenario(role),
        startMode: startPreference === "fresh" ? "fresh" : "reuse_latest",
        sendKickoff: startPreference === "fresh",
      });
    },
    [
      getPlanningStartPreference,
      handleOpenSessionStart,
      openAgents,
      openSessionInAgentStudio,
      sessions,
    ],
  );

  const handleBuild = useCallback(
    (taskId: string): void => {
      openAgents(taskId, "build");
    },
    [openAgents],
  );

  const handleHumanRequestChanges = useCallback(
    (taskId: string): void => {
      void (async () => {
        await humanRequestChangesTask(taskId);
        handleOpenSessionStart({
          taskId,
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse_latest",
          sendKickoff: true,
        });
      })();
    },
    [handleOpenSessionStart, humanRequestChangesTask],
  );

  const handleCreateTask = useCallback((): void => {
    setComposerTaskId(null);
    setTaskComposerOpen(true);
  }, []);

  const handleRefreshTasks = useCallback((): void => {
    void refreshTasks();
  }, [refreshTasks]);

  const handleTaskComposerOpenChange = useCallback((nextOpen: boolean): void => {
    setTaskComposerOpen(nextOpen);
    if (!nextOpen) {
      setComposerTaskId(null);
    }
  }, []);

  const handleDetailsOpenChange = useCallback((open: boolean): void => {
    if (!open) {
      setDetailsTaskId(null);
    }
  }, []);

  const handleEditTask = useCallback((taskId: string): void => {
    setDetailsTaskId(null);
    setComposerTaskId(taskId);
    setTaskComposerOpen(true);
  }, []);

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
    header: {
      isLoadingTasks,
      isSwitchingWorkspace,
      onCreateTask: handleCreateTask,
      onRefreshTasks: handleRefreshTasks,
    },
    content: {
      columns,
      runStateByTaskId,
      activeSessionsByTaskId,
      onOpenDetails: (taskId) => setDetailsTaskId(taskId),
      onDelegate: handleDelegate,
      onPlan: handlePlan,
      onBuild: handleBuild,
      onHumanApprove: (taskId) => {
        void humanApproveTask(taskId);
      },
      onHumanRequestChanges: handleHumanRequestChanges,
    },
    taskComposer: {
      open: isTaskComposerOpen,
      task: composerTask,
      tasks,
      onOpenChange: handleTaskComposerOpenChange,
    },
    detailsSheet: {
      task: detailsTask,
      allTasks: tasks,
      open: detailsTask !== null,
      onOpenChange: handleDetailsOpenChange,
      onPlan: handlePlan,
      onBuild: handleBuild,
      onDelegate: handleDelegate,
      onEdit: handleEditTask,
      onDefer: (taskId) => {
        void deferTask(taskId);
      },
      onResumeDeferred: (taskId) => {
        void resumeDeferredTask(taskId);
      },
      onHumanApprove: (taskId) => {
        void humanApproveTask(taskId);
      },
      onHumanRequestChanges: handleHumanRequestChanges,
      onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
    },
    sessionStartModal,
  };
}
