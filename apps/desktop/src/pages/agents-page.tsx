import {
  AgentChat,
  type AgentChatModel,
  isNearBottom,
  useAgentChatLayout,
} from "@/components/features/agents/agent-chat";
import {
  AgentStudioHeader,
  type AgentStudioHeaderModel,
} from "@/components/features/agents/agent-studio-header";
import {
  AgentStudioTaskTabs,
  type AgentStudioTaskTabsModel,
} from "@/components/features/agents/agent-studio-task-tabs";
import { AgentStudioWorkspaceSidebar } from "@/components/features/agents/agent-studio-workspace-sidebar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import {
  type ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ROLE_OPTIONS,
  SCENARIOS_BY_ROLE,
  SCENARIO_LABELS,
  firstScenario,
  isRole,
  isScenario,
  kickoffPromptForScenario,
} from "./agents-page-constants";
import {
  buildLatestSessionByRoleMap,
  buildLatestSessionByTaskMap,
  buildRoleEnabledMapForTask,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildTaskTabs,
  buildWorkflowStateByRole,
  canPersistTaskTabs,
  closeTaskTab,
  ensureActiveTaskTab,
  getAvailableTabTasks,
  parsePersistedTaskTabs,
  resolveFallbackTaskId,
  toPersistedTaskTabs,
} from "./agents-page-session-tabs";
import { toContextStorageKey, toTabsStorageKey } from "./agents-page-utils";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

export function AgentsPage(): ReactElement {
  const { activeRepo, loadRepoSettings } = useWorkspaceState();
  const { opencodeHealth, isLoadingChecks, refreshChecks } = useChecksState();
  const { isLoadingTasks, tasks } = useTasksState();
  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [repoSettings, setRepoSettings] = useState<RepoSettingsInput | null>(null);
  const [openTaskTabs, setOpenTaskTabs] = useState<string[]>([]);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState<string | null>(null);
  const [tabsStorageHydratedRepo, setTabsStorageHydratedRepo] = useState<string | null>(null);
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});
  const [todoPanelCollapsedBySession, setTodoPanelCollapsedBySession] = useState<
    Record<string, boolean>
  >({});
  const autoStartExecutedRef = useRef(new Set<string>());
  const restoredContextRepoRef = useRef<string | null>(null);
  const previousRepoForSessionRefs = useRef<string | null>(activeRepo);
  const startingSessionByTaskRef = useRef(new Map<string, Promise<string | undefined>>());

  const taskIdParam = searchParams.get("task") ?? "";
  const sessionParam = searchParams.get("session");
  const roleParam = searchParams.get("agent");
  const hasExplicitRoleParam = isRole(roleParam);
  const roleFromQuery: AgentRole = hasExplicitRoleParam ? roleParam : "spec";
  const scenarioParam = searchParams.get("scenario");
  const scenarioFromQuery: AgentScenario | undefined = isScenario(scenarioParam)
    ? scenarioParam
    : undefined;
  const autostart = searchParams.get("autostart") === "1";

  const selectedSessionById = useMemo(
    () => sessions.find((entry) => entry.sessionId === sessionParam) ?? null,
    [sessionParam, sessions],
  );
  const taskId = selectedSessionById?.taskId ?? taskIdParam;
  const agentStudioReady = Boolean(
    activeRepo && opencodeHealth?.runtimeOk && opencodeHealth?.mcpOk,
  );
  const agentStudioBlockedReason = !activeRepo
    ? "Select a repository to use Agent Studio."
    : opencodeHealth?.runtimeError
      ? opencodeHealth.runtimeError
      : opencodeHealth?.mcpError
        ? opencodeHealth.mcpError
        : isLoadingChecks
          ? "Checking OpenCode and OpenDucktor MCP health..."
          : "OpenCode runtime or OpenDucktor MCP is not ready.";

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId) ?? null,
    [taskId, tasks],
  );

  const sessionsForTask = useMemo(() => {
    return sessions
      .filter((entry) => entry.taskId === taskId)
      .sort((a, b) => {
        if (a.startedAt !== b.startedAt) {
          return a.startedAt > b.startedAt ? -1 : 1;
        }
        if (a.sessionId === b.sessionId) {
          return 0;
        }
        return a.sessionId > b.sessionId ? -1 : 1;
      });
  }, [sessions, taskId]);

  const activeSession = useMemo(() => {
    if (selectedSessionById?.taskId === taskId) {
      return selectedSessionById;
    }
    if (sessionParam) {
      return null;
    }
    if (hasExplicitRoleParam) {
      return sessionsForTask.find((entry) => entry.role === roleFromQuery) ?? null;
    }
    return sessionsForTask[0] ?? null;
  }, [
    hasExplicitRoleParam,
    roleFromQuery,
    selectedSessionById,
    sessionParam,
    sessionsForTask,
    taskId,
  ]);

  const role: AgentRole = roleFromQuery;
  const scenarios = SCENARIOS_BY_ROLE[role];
  const scenario =
    scenarioFromQuery && scenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(role);

  const contextSessions = sessionsForTask;

  const sessionByTaskId = useMemo(() => buildLatestSessionByTaskMap(sessions), [sessions]);

  const tabTaskIds = useMemo(
    () => ensureActiveTaskTab(openTaskTabs, taskId),
    [openTaskTabs, taskId],
  );

  const hydratedTasksByRepoAndTask = useAgentStudioTaskHydration({
    activeRepo,
    activeTaskId: taskId,
    tabTaskIds,
    loadAgentSessions,
  });
  const taskHydrationKey = activeRepo && taskId ? `${activeRepo}:${taskId}` : "";
  const isActiveTaskHydrated = taskHydrationKey
    ? (hydratedTasksByRepoAndTask[taskHydrationKey] ?? false)
    : false;

  const availableTabTasks = useMemo(
    () => getAvailableTabTasks(tasks, tabTaskIds),
    [tabTaskIds, tasks],
  );

  const taskTabs = useMemo(
    () =>
      buildTaskTabs({
        tabTaskIds,
        tasks,
        latestSessionByTaskId: sessionByTaskId,
        activeTaskId: taskId,
      }),
    [sessionByTaskId, tabTaskIds, taskId, tasks],
  );

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    taskId,
    activeSession,
    selectedTask,
  });

  const updateQuery = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (previousRepoForSessionRefs.current === activeRepo) {
      return;
    }
    previousRepoForSessionRefs.current = activeRepo;
    autoStartExecutedRef.current.clear();
    startingSessionByTaskRef.current.clear();
    if (!activeRepo) {
      restoredContextRepoRef.current = null;
    }
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    if (restoredContextRepoRef.current === activeRepo) {
      return;
    }

    const hasExplicitTaskContext =
      Boolean(searchParams.get("task")) || Boolean(searchParams.get("session"));
    if (hasExplicitTaskContext) {
      restoredContextRepoRef.current = activeRepo;
      return;
    }

    restoredContextRepoRef.current = activeRepo;
    const raw = globalThis.localStorage.getItem(toContextStorageKey(activeRepo));
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        taskId?: string;
        role?: string;
        scenario?: string;
        sessionId?: string;
      };
      const persistedRole = isRole(parsed.role ?? null) ? (parsed.role as AgentRole) : null;
      const persistedScenario = isScenario(parsed.scenario ?? null)
        ? (parsed.scenario as AgentScenario)
        : null;
      const explicitRoleParam = searchParams.get("agent");
      const explicitScenarioParam = searchParams.get("scenario");
      const roleForScenarioValidation = isRole(explicitRoleParam)
        ? explicitRoleParam
        : persistedRole;
      const next = new URLSearchParams(searchParams);
      if (parsed.taskId && parsed.taskId.trim().length > 0) {
        next.set("task", parsed.taskId);
      }
      if (persistedRole && !explicitRoleParam) {
        next.set("agent", persistedRole);
      }
      if (
        persistedScenario &&
        !explicitScenarioParam &&
        (!roleForScenarioValidation ||
          SCENARIOS_BY_ROLE[roleForScenarioValidation].includes(persistedScenario))
      ) {
        next.set("scenario", persistedScenario);
      }
      if (parsed.sessionId && parsed.sessionId.trim().length > 0) {
        next.set("session", parsed.sessionId);
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    } catch {}
  }, [activeRepo, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeRepo || restoredContextRepoRef.current !== activeRepo) {
      return;
    }
    const payload = {
      taskId: taskId || undefined,
      role,
      scenario,
      sessionId: activeSession?.sessionId,
    };
    globalThis.localStorage.setItem(toContextStorageKey(activeRepo), JSON.stringify(payload));
  }, [activeRepo, activeSession?.sessionId, role, scenario, taskId]);

  useEffect(() => {
    if (!activeRepo) {
      setOpenTaskTabs([]);
      setPersistedActiveTaskId(null);
      setTabsStorageHydratedRepo(null);
      return;
    }

    const raw = globalThis.localStorage.getItem(toTabsStorageKey(activeRepo));
    const persistedTabs = parsePersistedTaskTabs(raw);
    setOpenTaskTabs(persistedTabs.tabs);
    setPersistedActiveTaskId(persistedTabs.activeTaskId);
    setTabsStorageHydratedRepo(activeRepo);
  }, [activeRepo]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    const knownTaskIds = new Set(tasks.map((task) => task.id));
    setOpenTaskTabs((current) => {
      const filtered = current.filter((taskTabId) => knownTaskIds.has(taskTabId));
      if (filtered.length === current.length) {
        return current;
      }
      return filtered;
    });
  }, [isLoadingTasks, tasks]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    if (!selectedTask) {
      return;
    }
    setOpenTaskTabs((current) => {
      if (current.includes(taskId)) {
        return current;
      }
      return [...current, taskId];
    });
  }, [selectedTask, taskId]);

  useEffect(() => {
    if (!canPersistTaskTabs(activeRepo, tabsStorageHydratedRepo)) {
      return;
    }
    if (!activeRepo) {
      return;
    }
    globalThis.localStorage.setItem(
      toTabsStorageKey(activeRepo),
      toPersistedTaskTabs({
        tabs: openTaskTabs,
        activeTaskId: taskId || null,
      }),
    );
  }, [activeRepo, openTaskTabs, tabsStorageHydratedRepo, taskId]);

  useEffect(() => {
    if (taskId || openTaskTabs.length === 0) {
      return;
    }
    const fallbackTaskId = resolveFallbackTaskId({
      tabTaskIds: openTaskTabs,
      persistedActiveTaskId,
    });
    if (!fallbackTaskId) {
      return;
    }
    void updateQuery({
      task: fallbackTaskId,
      session: undefined,
      autostart: undefined,
    });
  }, [openTaskTabs, persistedActiveTaskId, taskId, updateQuery]);

  useEffect(() => {
    if (!activeRepo) {
      setRepoSettings(null);
      return;
    }
    let cancelled = false;
    void loadRepoSettings()
      .then((settings) => {
        if (!cancelled) {
          setRepoSettings(settings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepoSettings(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, loadRepoSettings]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    if (!taskIdParam || selectedSessionById) {
      return;
    }
    if (tasks.some((entry) => entry.id === taskIdParam)) {
      return;
    }
    void updateQuery({
      task: undefined,
      session: undefined,
      agent: undefined,
      scenario: undefined,
      autostart: undefined,
    });
  }, [isLoadingTasks, selectedSessionById, taskIdParam, tasks, updateQuery]);

  useEffect(() => {
    if (!sessionParam || selectedSessionById) {
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    void updateQuery({ session: undefined });
  }, [isActiveTaskHydrated, selectedSessionById, sessionParam, taskId, updateQuery]);

  useEffect(() => {
    if (!selectedSessionById) {
      return;
    }
    if (selectedSessionById.taskId === taskIdParam) {
      return;
    }
    void updateQuery({ task: selectedSessionById.taskId });
  }, [selectedSessionById, taskIdParam, updateQuery]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const updates: Record<string, string | undefined> = {};
    if (searchParams.get("task") !== activeSession.taskId) {
      updates.task = activeSession.taskId;
    }
    if (searchParams.get("session") !== activeSession.sessionId) {
      updates.session = activeSession.sessionId;
    }
    if (searchParams.get("autostart")) {
      updates.autostart = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }
    void updateQuery(updates);
  }, [activeSession, searchParams, updateQuery]);

  const {
    selectionForNewSession,
    selectedModelSelection,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
    activeSessionContextUsage,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useAgentStudioModelSelection({
    activeRepo,
    activeSession,
    role,
    repoSettings,
    updateAgentSessionModel,
  });

  const startSession = useCallback(async (): Promise<string | undefined> => {
    if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
      return undefined;
    }

    if (activeSession) {
      updateQuery({
        task: activeSession.taskId,
        session: activeSession.sessionId,
        autostart: undefined,
      });
      return activeSession.sessionId;
    }

    const inFlightSessionStart = startingSessionByTaskRef.current.get(taskId);
    if (inFlightSessionStart) {
      return inFlightSessionStart;
    }

    const startPromise = (async (): Promise<string | undefined> => {
      setIsStarting(true);
      try {
        const sessionId = await startAgentSession({ taskId, role, scenario, sendKickoff: false });
        if (selectionForNewSession) {
          updateAgentSessionModel(sessionId, selectionForNewSession);
        }
        updateQuery({
          task: taskId,
          agent: role,
          scenario,
          session: sessionId,
          autostart: undefined,
        });
        return sessionId;
      } finally {
        startingSessionByTaskRef.current.delete(taskId);
        setIsStarting(false);
      }
    })();

    startingSessionByTaskRef.current.set(taskId, startPromise);
    return startPromise;
  }, [
    agentStudioReady,
    isActiveTaskHydrated,
    role,
    scenario,
    selectionForNewSession,
    activeSession,
    startAgentSession,
    taskId,
    updateAgentSessionModel,
    updateQuery,
  ]);

  const startScenarioKickoff = useCallback(async (): Promise<void> => {
    if (!taskId || !agentStudioReady) {
      return;
    }
    const sessionId = await startSession();
    if (!sessionId) {
      return;
    }
    await sendAgentMessage(sessionId, kickoffPromptForScenario(role, scenario, taskId));
  }, [agentStudioReady, role, scenario, sendAgentMessage, startSession, taskId]);

  useEffect(() => {
    if (
      !autostart ||
      !activeRepo ||
      !taskId ||
      activeSession ||
      !agentStudioReady ||
      !isActiveTaskHydrated
    ) {
      return;
    }
    const key = `${activeRepo}:${taskId}:${role}:${scenario}`;
    if (autoStartExecutedRef.current.has(key)) {
      return;
    }
    autoStartExecutedRef.current.add(key);
    void startScenarioKickoff();
  }, [
    activeRepo,
    activeSession,
    agentStudioReady,
    autostart,
    isActiveTaskHydrated,
    role,
    scenario,
    startScenarioKickoff,
    taskId,
  ]);

  const onSend = useCallback(async (): Promise<void> => {
    if (isSending || isStarting || !agentStudioReady) {
      return;
    }

    const message = input.trim();
    if (!message || !taskId) {
      return;
    }

    const shouldStartNew = !activeSession;
    let targetSessionId = activeSession?.sessionId;
    if (shouldStartNew) {
      targetSessionId = await startSession();
    }

    if (!targetSessionId) {
      return;
    }

    setInput("");
    setIsSending(true);
    try {
      await sendAgentMessage(targetSessionId, message);
    } finally {
      setIsSending(false);
    }
  }, [
    activeSession,
    agentStudioReady,
    input,
    isSending,
    isStarting,
    sendAgentMessage,
    startSession,
    taskId,
  ]);

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSession || !agentStudioReady) {
        return;
      }

      const sessionId = activeSession.sessionId;
      setIsSubmittingQuestionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      try {
        await answerAgentQuestion(sessionId, requestId, answers);
      } finally {
        setIsSubmittingQuestionByRequestId((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeSession, agentStudioReady, answerAgentQuestion],
  );

  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeSessionId: activeSession?.sessionId ?? null,
      pendingPermissions: activeSession?.pendingPermissions ?? [],
      agentStudioReady,
      replyAgentPermission,
    });

  const activeMessageCount = activeSession?.messages.length ?? 0;
  const activeDraftText = activeSession?.draftAssistantText ?? "";
  const activeSessionStatus = activeSession?.status ?? "stopped";
  const isSessionWorking =
    Boolean(activeSession) &&
    (activeSessionStatus === "running" || activeSessionStatus === "starting" || isSending);
  const scrollTrigger = `${activeSessionStatus}:${activeMessageCount}:${activeDraftText.length}:${
    activeSession?.pendingQuestions.length ?? 0
  }`;
  const {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    setIsPinnedToBottom,
    todoPanelBottomOffset,
    resizeComposerTextarea,
  } = useAgentChatLayout({
    input,
    scrollTrigger,
    activeSessionId: activeSession?.sessionId ?? null,
  });

  useEffect(() => {
    if (!isSending) {
      return;
    }
    if (activeSessionStatus !== "starting" && activeSessionStatus !== "running") {
      setIsSending(false);
      return;
    }
    setIsSending(false);
  }, [activeSessionStatus, isSending]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Session change must reset submit state map.
  useEffect(() => {
    setIsSubmittingQuestionByRequestId({});
  }, [activeSession?.sessionId]);

  useEffect(() => {
    const activeRequestIds = new Set(
      (activeSession?.pendingQuestions ?? []).map((entry) => entry.requestId),
    );
    setIsSubmittingQuestionByRequestId((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [requestId, isSubmitting] of Object.entries(current)) {
        if (!activeRequestIds.has(requestId)) {
          changed = true;
          continue;
        }
        next[requestId] = isSubmitting;
      }
      return changed ? next : current;
    });
  }, [activeSession?.pendingQuestions]);

  const canKickoffNewSession =
    agentStudioReady && Boolean(taskId) && isActiveTaskHydrated && !activeSession;
  const kickoffLabel = role === "spec" ? "Start Spec" : `Start ${SCENARIO_LABELS[scenario]}`;
  const canStopSession = Boolean(activeSession && isSessionWorking);

  const handleSelectTab = useCallback(
    (nextTaskId: string) => {
      if (!nextTaskId) {
        return;
      }

      setInput("");
      setOpenTaskTabs((current) => {
        if (current.includes(nextTaskId)) {
          return current;
        }
        return [...current, nextTaskId];
      });
      setPersistedActiveTaskId(nextTaskId);

      const sessionForTask = sessionByTaskId.get(nextTaskId);
      if (sessionForTask) {
        void updateQuery({
          task: sessionForTask.taskId,
          session: sessionForTask.sessionId,
          autostart: undefined,
        });
        return;
      }

      void updateQuery({
        task: nextTaskId,
        session: undefined,
        autostart: undefined,
      });
    },
    [sessionByTaskId, updateQuery],
  );

  const handleCreateTab = useCallback(
    (nextTaskId: string) => {
      void handleSelectTab(nextTaskId);
    },
    [handleSelectTab],
  );

  const handleCloseTab = useCallback(
    (taskIdToClose: string) => {
      const { nextTabTaskIds, nextActiveTaskId } = closeTaskTab({
        tabTaskIds,
        taskIdToClose,
        activeTaskId: taskId,
      });

      if (nextTabTaskIds === tabTaskIds) {
        return;
      }

      setOpenTaskTabs(nextTabTaskIds);
      setPersistedActiveTaskId(nextActiveTaskId ?? null);

      if (taskIdToClose !== taskId) {
        return;
      }

      setInput("");
      if (!nextActiveTaskId) {
        void updateQuery({
          task: undefined,
          session: undefined,
          autostart: undefined,
        });
        return;
      }

      globalThis.setTimeout(() => {
        const nextTrigger = globalThis.document.getElementById(
          `agent-studio-tab-${nextActiveTaskId}`,
        );
        if (nextTrigger instanceof HTMLElement) {
          nextTrigger.focus();
        }
      }, 0);

      const fallbackSession = sessionByTaskId.get(nextActiveTaskId);
      if (fallbackSession) {
        void updateQuery({
          task: fallbackSession.taskId,
          session: fallbackSession.sessionId,
          autostart: undefined,
        });
        return;
      }

      void updateQuery({
        task: nextActiveTaskId,
        session: undefined,
        autostart: undefined,
      });
    },
    [sessionByTaskId, tabTaskIds, taskId, updateQuery],
  );

  const handleWorkflowStepSelect = useCallback(
    (_nextRole: AgentRole, sessionId: string | null) => {
      if (!sessionId) {
        return;
      }
      const session = sessionsForTask.find((entry) => entry.sessionId === sessionId);
      if (!session) {
        return;
      }
      void updateQuery({
        task: session.taskId,
        session: session.sessionId,
        autostart: undefined,
      });
    },
    [sessionsForTask, updateQuery],
  );

  const handleSessionSelectionChange = useCallback(
    (nextValue: string) => {
      if (!taskId) {
        return;
      }
      const selectedSession = sessionsForTask.find((entry) => entry.sessionId === nextValue);
      if (!selectedSession) {
        return;
      }
      void updateQuery({
        task: selectedSession.taskId,
        session: selectedSession.sessionId,
        autostart: undefined,
      });
    },
    [sessionsForTask, taskId, updateQuery],
  );

  const handleCreateSession = useCallback(
    (nextRole: AgentRole, nextScenario: AgentScenario) => {
      if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return;
      }
      if (activeSession && isSessionWorking) {
        return;
      }

      const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
      if (!roleEnabledByTask[nextRole]) {
        return;
      }

      const startKey = `${taskId}:${nextRole}:${nextScenario}`;
      const existing = startingSessionByTaskRef.current.get(startKey);
      if (existing) {
        void existing;
        return;
      }

      const startPromise = (async (): Promise<string | undefined> => {
        try {
          setIsStarting(true);
          const sessionId = await startAgentSession({
            taskId,
            role: nextRole,
            scenario: nextScenario,
            sendKickoff: true,
          });
          if (!sessionId) {
            return undefined;
          }
          void updateQuery({
            task: taskId,
            session: sessionId,
            agent: nextRole,
            scenario: nextScenario,
            autostart: undefined,
          });
          return sessionId;
        } finally {
          setIsStarting(false);
        }
      })();

      startingSessionByTaskRef.current.set(startKey, startPromise);
      void startPromise.finally(() => {
        if (startingSessionByTaskRef.current.get(startKey) === startPromise) {
          startingSessionByTaskRef.current.delete(startKey);
        }
      });
    },
    [
      activeSession,
      agentStudioReady,
      isActiveTaskHydrated,
      isSessionWorking,
      selectedTask,
      startAgentSession,
      taskId,
      updateQuery,
    ],
  );

  const handleMessagesScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setIsPinnedToBottom(isNearBottom(event.currentTarget));
    },
    [setIsPinnedToBottom],
  );

  const agentStudioTaskTabsModel: AgentStudioTaskTabsModel = {
    tabs: taskTabs,
    availableTabTasks,
    isLoadingAvailableTabTasks: isLoadingTasks,
    onCreateTab: handleCreateTab,
    onCloseTab: handleCloseTab,
    agentStudioReady,
  };

  const activeTabValue = taskId || "__agent_studio_empty__";

  const roleEnabledByTask = useMemo(() => buildRoleEnabledMapForTask(selectedTask), [selectedTask]);
  const latestSessionByRole = useMemo(
    () => buildLatestSessionByRoleMap(sessionsForTask),
    [sessionsForTask],
  );
  const workflowStateByRole = useMemo(
    () =>
      buildWorkflowStateByRole({
        roleEnabledByTask,
        sessionsForTask,
        activeSessionRole: activeSession?.role ?? null,
      }),
    [activeSession?.role, roleEnabledByTask, sessionsForTask],
  );
  const roleLabelByRole = useMemo(
    () =>
      ROLE_OPTIONS.reduce(
        (acc, entry) => {
          acc[entry.role] = entry.label;
          return acc;
        },
        { spec: "Spec", planner: "Planner", build: "Build", qa: "QA" } as Record<AgentRole, string>,
      ),
    [],
  );
  const sessionSelectorGroups = useMemo(
    () =>
      buildSessionSelectorGroups({
        sessionsForTask,
        scenarioLabels: SCENARIO_LABELS,
        roleLabelByRole,
      }),
    [roleLabelByRole, sessionsForTask],
  );
  const sessionSelectorValue = activeSession?.sessionId ?? sessionsForTask[0]?.sessionId ?? "";
  const createSessionDisabled = Boolean(activeSession && isSessionWorking);
  const hasSpecDoc = specDoc.markdown.trim().length > 0;
  const hasPlanDoc = planDoc.markdown.trim().length > 0;
  const hasQaFeedback = qaDoc.markdown.trim().length > 0;
  const hasHumanFeedback = Boolean(
    selectedTask &&
      (selectedTask.status === "human_review" ||
        selectedTask.availableActions.includes("human_request_changes") ||
        selectedTask.availableActions.includes("human_approve")),
  );
  const sessionCreateOptions = useMemo(
    () =>
      buildSessionCreateOptions({
        roleEnabledByTask,
        hasSpecDoc,
        hasPlanDoc,
        hasQaFeedback,
        hasHumanFeedback,
        createSessionDisabled,
        roleLabelByRole,
        scenarioLabels: SCENARIO_LABELS,
      }),
    [
      createSessionDisabled,
      hasHumanFeedback,
      hasPlanDoc,
      hasQaFeedback,
      hasSpecDoc,
      roleEnabledByTask,
      roleLabelByRole,
    ],
  );

  const agentStudioHeaderModel: AgentStudioHeaderModel = {
    taskTitle: selectedTask?.title ?? null,
    taskId: selectedTask?.id ?? null,
    sessionStatus: activeSession?.status ?? null,
    workflowSteps: ROLE_OPTIONS.map((entry) => ({
      role: entry.role,
      label: entry.label,
      icon: entry.icon,
      state: workflowStateByRole[entry.role],
      sessionId: latestSessionByRole[entry.role]?.sessionId ?? null,
    })),
    onWorkflowStepSelect: handleWorkflowStepSelect,
    sessionSelector: {
      value: sessionSelectorValue,
      groups: sessionSelectorGroups,
      disabled: !agentStudioReady || sessionsForTask.length === 0,
      onValueChange: handleSessionSelectionChange,
    },
    sessionCreateOptions,
    onCreateSession: handleCreateSession,
    createSessionDisabled,
    isCreatingSession: isStarting,
    stats: {
      sessions: contextSessions.length,
      messages: activeSession?.messages.length ?? 0,
      permissions: activeSession?.pendingPermissions.length ?? 0,
      questions: activeSession?.pendingQuestions.length ?? 0,
    },
    agentStudioReady,
  };

  const agentStudioWorkspaceSidebarModel = {
    agentStudioReady,
    pendingPermissions: activeSession?.pendingPermissions ?? [],
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => {
      void onReplyPermission(requestId, reply);
    },
    specDoc,
    planDoc,
    qaDoc,
  };

  const agentChatModel: AgentChatModel = {
    thread: {
      session: activeSession,
      roleOptions: ROLE_OPTIONS,
      agentStudioReady,
      blockedReason: agentStudioBlockedReason,
      isLoadingChecks,
      onRefreshChecks: () => {
        void refreshChecks();
      },
      taskSelected: Boolean(taskId),
      canKickoffNewSession,
      kickoffLabel,
      onKickoff: () => {
        void startScenarioKickoff();
      },
      isStarting,
      isSending,
      sessionAgentColors: activeSessionAgentColors,
      isSubmittingQuestionByRequestId,
      onSubmitQuestionAnswers,
      todoPanelCollapsed: activeSession
        ? (todoPanelCollapsedBySession[activeSession.sessionId] ?? false)
        : false,
      onToggleTodoPanel: () => {
        if (!activeSession) {
          return;
        }
        const collapsed = todoPanelCollapsedBySession[activeSession.sessionId] ?? false;
        setTodoPanelCollapsedBySession((current) => ({
          ...current,
          [activeSession.sessionId]: !collapsed,
        }));
      },
      todoPanelBottomOffset,
      messagesContainerRef,
      onMessagesScroll: handleMessagesScroll,
    },
    composer: {
      taskId,
      agentStudioReady,
      input,
      onInputChange: setInput,
      onSend: () => {
        void onSend();
      },
      isSending,
      isStarting,
      isSessionWorking,
      selectedModelSelection,
      isSelectionCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
      contextUsage:
        activeSessionContextUsage === null
          ? null
          : {
              totalTokens: activeSessionContextUsage.totalTokens,
              contextWindow: activeSessionContextUsage.contextWindow,
              ...(typeof activeSessionContextUsage.outputLimit === "number"
                ? { outputLimit: activeSessionContextUsage.outputLimit }
                : {}),
            },
      canStopSession,
      onStopSession: () => {
        if (!activeSession) {
          return;
        }
        void stopAgentSession(activeSession.sessionId);
      },
      composerFormRef,
      composerTextareaRef,
      onComposerTextareaInput: resizeComposerTextarea,
    },
  };

  return (
    <Tabs
      value={activeTabValue}
      onValueChange={handleSelectTab}
      className="h-[calc(100vh-2rem)] min-h-0 max-h-[calc(100vh-2rem)] gap-0 overflow-hidden"
    >
      <AgentStudioTaskTabs model={agentStudioTaskTabsModel} />

      <TabsContent value={activeTabValue} className="m-0 min-h-0 flex-1 rounded-b-xl bg-white p-3">
        {taskId ? (
          <div className="grid h-full min-h-0 gap-4 overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(420px,1fr)]">
            <AgentChat
              header={<AgentStudioHeader model={agentStudioHeaderModel} />}
              model={agentChatModel}
            />

            <AgentStudioWorkspaceSidebar model={agentStudioWorkspaceSidebarModel} />
          </div>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            Open a task tab to start a workspace.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
