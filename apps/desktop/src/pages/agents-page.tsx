import { resolveAgentAccentColor } from "@/components/features/agents/agent-accent-color";
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
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents/catalog-select-options";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import type { ComboboxOption } from "@/components/ui/combobox";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import { loadRepoOpencodeCatalog } from "@/state/operations/opencode-catalog";
import type { RepoSettingsInput } from "@/types/state-slices";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import { normalizeOdtWorkflowToolName } from "@openducktor/core";
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
  buildLatestSessionByTaskMap,
  buildRoleEnabledMapForTask,
  buildTaskTabs,
  canPersistTaskTabs,
  closeTaskTab,
  ensureActiveTaskTab,
  getAvailableTabTasks,
  parsePersistedTaskTabs,
  resolveFallbackTaskId,
  toPersistedTaskTabs,
} from "./agents-page-session-tabs";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openducktor:agent-studio:context";
const AGENT_STUDIO_TABS_STORAGE_PREFIX = "openducktor:agent-studio:tabs";
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})/;

const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

const extractCompletionTimestamp = (
  value: string | undefined,
): { raw: string; timestamp: number } | null => {
  if (!value) {
    return null;
  }
  const match = value.match(ISO_TIMESTAMP_PATTERN);
  if (!match?.[0]) {
    return null;
  }
  const timestamp = parseTimestamp(match[0]);
  if (timestamp === null) {
    return null;
  }
  return {
    raw: match[0],
    timestamp,
  };
};

const toContextStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_CONTEXT_STORAGE_PREFIX}:${repoPath}`;

const toTabsStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_TABS_STORAGE_PREFIX}:${repoPath}`;

const emptyDraftSelections = (): Record<AgentRole, AgentModelSelection | null> => ({
  spec: null,
  planner: null,
  build: null,
  qa: null,
});

const pickDefaultSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
): AgentModelSelection | null => {
  if (!catalog || catalog.models.length === 0) {
    return null;
  }
  const defaultProvider = Object.entries(catalog.defaultModelsByProvider).find(([, modelId]) =>
    catalog.models.some((entry) => entry.modelId === modelId),
  );
  const selectedModel = defaultProvider
    ? (catalog.models.find(
        (entry) => entry.providerId === defaultProvider[0] && entry.modelId === defaultProvider[1],
      ) ?? catalog.models[0])
    : catalog.models[0];
  if (!selectedModel) {
    return null;
  }

  const primaryAgent = catalog.agents.find((entry) => !entry.hidden && entry.mode === "primary");
  const fallbackAgent = catalog.agents.find((entry) => !entry.hidden && entry.mode !== "subagent");
  const selectedAgent = primaryAgent?.name ?? fallbackAgent?.name ?? undefined;

  return {
    providerId: selectedModel.providerId,
    modelId: selectedModel.modelId,
    ...(selectedModel.variants[0] ? { variant: selectedModel.variants[0] } : {}),
    ...(selectedAgent ? { opencodeAgent: selectedAgent } : {}),
  };
};

const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!catalog || !selection) {
    return selection;
  }
  const model = catalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model) {
    return null;
  }

  const hasVariant = Boolean(selection.variant && model.variants.includes(selection.variant));
  const hasAgent = Boolean(
    selection.opencodeAgent &&
      catalog.agents.some(
        (agent) =>
          agent.name === selection.opencodeAgent && !agent.hidden && agent.mode !== "subagent",
      ),
  );

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};

const isSameSelection = (
  a: AgentModelSelection | null | undefined,
  b: AgentModelSelection | null | undefined,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    (a.variant ?? "") === (b.variant ?? "") &&
    (a.opencodeAgent ?? "") === (b.opencodeAgent ?? "")
  );
};

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
  const [composerCatalog, setComposerCatalog] = useState<AgentModelCatalog | null>(null);
  const [isLoadingComposerCatalog, setIsLoadingComposerCatalog] = useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);
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
  const processedDocumentToolEventsRef = useRef(new Set<string>());
  const processedDocumentMessageCountBySessionRef = useRef<Record<string, number>>({});
  const documentReloadAttemptsRef = useRef(new Map<string, number>());
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

  const role: AgentRole = activeSession?.role ?? roleFromQuery;
  const scenarios = SCENARIOS_BY_ROLE[role];
  const scenario =
    activeSession?.scenario ??
    (scenarioFromQuery && scenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(role));

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

  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded, reloadDocument, applyDocumentUpdate } =
    useTaskDocuments(taskId || null, true);
  const documentContextKey = `${taskId}:${activeSession?.sessionId ?? ""}`;
  const refreshedTaskVersionRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Context key is used as explicit reset trigger.
  useEffect(() => {
    processedDocumentToolEventsRef.current.clear();
    processedDocumentMessageCountBySessionRef.current = {};
    documentReloadAttemptsRef.current.clear();
    refreshedTaskVersionRef.current = null;
  }, [documentContextKey]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    ensureDocumentLoaded("spec");
    ensureDocumentLoaded("plan");
    ensureDocumentLoaded("qa");
  }, [ensureDocumentLoaded, taskId]);

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
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo) {
      setComposerCatalog(null);
      setIsLoadingComposerCatalog(false);
      restoredContextRepoRef.current = null;
      return;
    }
    let cancelled = false;
    setComposerCatalog(null);
    setIsLoadingComposerCatalog(true);
    void loadRepoOpencodeCatalog(activeRepo)
      .then((catalog) => {
        if (!cancelled) {
          setComposerCatalog(catalog);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComposerCatalog(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingComposerCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
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
    } catch {
      // Ignore malformed persisted context and continue with query defaults.
    }
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
    if (searchParams.get("agent") !== activeSession.role) {
      updates.agent = activeSession.role;
    }
    if (searchParams.get("scenario") !== activeSession.scenario) {
      updates.scenario = activeSession.scenario;
    }
    if (searchParams.get("autostart")) {
      updates.autostart = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }
    void updateQuery(updates);
  }, [activeSession, searchParams, updateQuery]);

  const roleDefaultSelection = useMemo<AgentModelSelection | null>(() => {
    const roleDefault = repoSettings?.agentDefaults[role];
    if (!roleDefault || !roleDefault.providerId || !roleDefault.modelId) {
      return null;
    }
    return {
      providerId: roleDefault.providerId,
      modelId: roleDefault.modelId,
      ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
      ...(roleDefault.opencodeAgent ? { opencodeAgent: roleDefault.opencodeAgent } : {}),
    };
  }, [repoSettings?.agentDefaults, role]);

  useEffect(() => {
    if (activeSession) {
      return;
    }
    setDraftSelectionByRole((current) => {
      const existing = current[role];
      const preferredBase =
        existing ?? roleDefaultSelection ?? pickDefaultSelectionForCatalog(composerCatalog);
      const normalized =
        normalizeSelectionForCatalog(composerCatalog, preferredBase) ??
        pickDefaultSelectionForCatalog(composerCatalog);
      if (isSameSelection(existing, normalized)) {
        return current;
      }
      return {
        ...current,
        [role]: normalized,
      };
    });
  }, [activeSession, composerCatalog, role, roleDefaultSelection]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const preferredSelection =
      normalizeSelectionForCatalog(
        activeSession.modelCatalog,
        activeSession.selectedModel ??
          roleDefaultSelection ??
          pickDefaultSelectionForCatalog(activeSession.modelCatalog),
      ) ?? pickDefaultSelectionForCatalog(activeSession.modelCatalog);
    if (!preferredSelection || isSameSelection(activeSession.selectedModel, preferredSelection)) {
      return;
    }
    updateAgentSessionModel(activeSession.sessionId, preferredSelection);
  }, [activeSession, roleDefaultSelection, updateAgentSessionModel]);

  const draftSelection = draftSelectionByRole[role];
  const selectionCatalog = activeSession?.modelCatalog ?? composerCatalog;
  const isSelectionCatalogLoading = activeSession
    ? activeSession.isLoadingModelCatalog
    : isLoadingComposerCatalog;
  const fallbackCatalogSelection = useMemo(
    () => pickDefaultSelectionForCatalog(selectionCatalog),
    [selectionCatalog],
  );
  const selectedModelSelection = useMemo(
    () =>
      activeSession?.selectedModel ??
      draftSelection ??
      roleDefaultSelection ??
      fallbackCatalogSelection ??
      null,
    [activeSession?.selectedModel, draftSelection, fallbackCatalogSelection, roleDefaultSelection],
  );

  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (activeSession) {
        updateAgentSessionModel(activeSession.sessionId, selection);
        return;
      }
      setDraftSelectionByRole((current) => ({
        ...current,
        [role]: selection,
      }));
    },
    [activeSession, role, updateAgentSessionModel],
  );

  const selectionForNewSession = useMemo(
    () =>
      draftSelection ??
      roleDefaultSelection ??
      normalizeSelectionForCatalog(selectionCatalog, fallbackCatalogSelection) ??
      fallbackCatalogSelection ??
      null,
    [draftSelection, fallbackCatalogSelection, roleDefaultSelection, selectionCatalog],
  );

  const startSession = useCallback(async (): Promise<string | undefined> => {
    if (!taskId || !agentStudioReady || !isActiveTaskHydrated) {
      return undefined;
    }

    if (activeSession) {
      updateQuery({
        task: activeSession.taskId,
        agent: activeSession.role,
        scenario: activeSession.scenario,
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

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const fallbackAgent = selectedModelSelection?.opencodeAgent;
    const fallbackAgentColor = resolveAgentAccentColor(fallbackAgent);
    if (fallbackAgent && fallbackAgent.trim().length > 0) {
      return [
        {
          value: fallbackAgent,
          label: fallbackAgent,
          description: "Current session agent",
          ...(fallbackAgentColor ? { accentColor: fallbackAgentColor } : {}),
        },
      ];
    }
    return [];
  }, [selectedModelSelection?.opencodeAgent, selectionCatalog]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const options = toModelOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const selected = selectedModelSelection;
    if (selected?.providerId && selected.modelId) {
      return [
        {
          value: `${selected.providerId}/${selected.modelId}`,
          label: selected.modelId,
          description: `${selected.providerId} (current session model)`,
        },
      ];
    }
    return [];
  }, [selectedModelSelection, selectionCatalog]);

  const modelGroups = useMemo(() => toModelGroupsByProvider(selectionCatalog), [selectionCatalog]);

  const selectedModelEntry = useMemo(() => {
    if (!selectionCatalog || !selectedModelSelection) {
      return null;
    }
    return (
      selectionCatalog.models.find(
        (entry) =>
          entry.providerId === selectedModelSelection.providerId &&
          entry.modelId === selectedModelSelection.modelId,
      ) ?? null
    );
  }, [selectedModelSelection, selectionCatalog]);

  const variantOptions = useMemo(() => {
    if (!selectedModelEntry) {
      const selectedVariant = selectedModelSelection?.variant;
      if (selectedVariant && selectedVariant.trim().length > 0) {
        return [
          {
            value: selectedVariant,
            label: selectedVariant,
          },
        ];
      }
      return [];
    }
    return selectedModelEntry.variants.map((variant) => ({
      value: variant,
      label: variant,
    }));
  }, [selectedModelEntry, selectedModelSelection?.variant]);

  const scenarioOptions = useMemo<ComboboxOption[]>(() => {
    return scenarios.map((entry) => ({
      value: entry,
      label: SCENARIO_LABELS[entry],
      description: entry,
    }));
  }, [scenarios]);

  const activeSessionAgentColors = useMemo<Record<string, string>>(() => {
    if (!activeSession?.modelCatalog) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const descriptor of activeSession.modelCatalog.agents) {
      if (!descriptor.name) {
        continue;
      }
      const color = resolveAgentAccentColor(descriptor.name, descriptor.color);
      if (color) {
        map[descriptor.name] = color;
      }
    }
    return map;
  }, [activeSession?.modelCatalog]);

  const activeSessionContextUsage = useMemo(() => {
    if (!activeSession) {
      return null;
    }

    const messages = activeSession.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== "assistant" || message.meta?.kind !== "assistant") {
        continue;
      }
      const totalTokens = message.meta.totalTokens;
      if (typeof totalTokens !== "number" || totalTokens <= 0) {
        continue;
      }

      const metaProviderId = message.meta.providerId;
      const metaModelId = message.meta.modelId;
      const modelDescriptor = activeSession.modelCatalog?.models.find(
        (entry) => entry.providerId === metaProviderId && entry.modelId === metaModelId,
      );
      const contextWindow =
        message.meta.contextWindow ??
        modelDescriptor?.contextWindow ??
        selectedModelEntry?.contextWindow;
      if (typeof contextWindow !== "number" || contextWindow <= 0) {
        return null;
      }

      return {
        totalTokens,
        contextWindow,
        outputLimit: message.meta.outputLimit ?? modelDescriptor?.outputLimit,
      };
    }

    return null;
  }, [activeSession, selectedModelEntry?.contextWindow]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Session change resets pending submit state map.
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

  useEffect(() => {
    if (!taskId || !selectedTask) {
      return;
    }

    const taskVersionKey = `${taskId}:${selectedTask.updatedAt}`;
    if (refreshedTaskVersionRef.current === taskVersionKey) {
      return;
    }

    refreshedTaskVersionRef.current = taskVersionKey;
    reloadDocument("spec");
    reloadDocument("plan");
    reloadDocument("qa");
  }, [reloadDocument, selectedTask, taskId]);

  useEffect(() => {
    if (!activeSession || !taskId) {
      return;
    }

    const previousMessageCount =
      processedDocumentMessageCountBySessionRef.current[activeSession.sessionId] ?? 0;
    const startIndex =
      previousMessageCount > activeSession.messages.length ? 0 : previousMessageCount;

    for (let index = startIndex; index < activeSession.messages.length; index += 1) {
      const message = activeSession.messages[index];
      if (!message) {
        continue;
      }
      const eventKey = `${activeSession.sessionId}:${message.id}`;
      if (processedDocumentToolEventsRef.current.has(eventKey)) {
        continue;
      }

      const meta = message.meta;
      if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
        continue;
      }
      const normalizedTool = normalizeOdtWorkflowToolName(meta.tool);
      const target =
        normalizedTool === "odt_set_spec"
          ? { section: "spec" as const, state: specDoc, inputKey: "markdown" as const }
          : normalizedTool === "odt_set_plan"
            ? { section: "plan" as const, state: planDoc, inputKey: "markdown" as const }
            : normalizedTool === "odt_qa_approved" || normalizedTool === "odt_qa_rejected"
              ? { section: "qa" as const, state: qaDoc, inputKey: "reportMarkdown" as const }
              : null;
      if (!target) {
        continue;
      }

      const completionInfo =
        extractCompletionTimestamp(meta.output) ?? extractCompletionTimestamp(message.content);
      const toolInput =
        typeof meta.input === "object" && meta.input !== null
          ? (meta.input as Record<string, unknown>)
          : null;
      const inputMarkdown = toolInput?.[target.inputKey];

      let effectiveUpdatedAtTimestamp = parseTimestamp(target.state.updatedAt);
      if (typeof inputMarkdown === "string" && inputMarkdown.trim().length > 0) {
        const shouldApplyOptimisticDocument =
          target.state.markdown.trim() !== inputMarkdown.trim() ||
          (completionInfo !== null &&
            (effectiveUpdatedAtTimestamp === null ||
              effectiveUpdatedAtTimestamp < completionInfo.timestamp));
        if (shouldApplyOptimisticDocument) {
          applyDocumentUpdate(target.section, {
            markdown: inputMarkdown,
            updatedAt: completionInfo?.raw ?? target.state.updatedAt ?? new Date().toISOString(),
          });
          effectiveUpdatedAtTimestamp = completionInfo?.timestamp ?? effectiveUpdatedAtTimestamp;
        }
      }

      if (
        completionInfo !== null &&
        effectiveUpdatedAtTimestamp !== null &&
        effectiveUpdatedAtTimestamp >= completionInfo.timestamp
      ) {
        processedDocumentToolEventsRef.current.add(eventKey);
        documentReloadAttemptsRef.current.delete(eventKey);
        continue;
      }

      if (target.state.isLoading) {
        continue;
      }

      const attempts = documentReloadAttemptsRef.current.get(eventKey) ?? 0;
      if (attempts >= 6) {
        processedDocumentToolEventsRef.current.add(eventKey);
        documentReloadAttemptsRef.current.delete(eventKey);
        continue;
      }

      const triggered = reloadDocument(target.section);
      if (triggered) {
        documentReloadAttemptsRef.current.set(eventKey, attempts + 1);
      }
    }

    processedDocumentMessageCountBySessionRef.current[activeSession.sessionId] =
      activeSession.messages.length;
  }, [activeSession, applyDocumentUpdate, planDoc, qaDoc, reloadDocument, specDoc, taskId]);

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
          agent: sessionForTask.role,
          scenario: sessionForTask.scenario,
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
          agent: fallbackSession.role,
          scenario: fallbackSession.scenario,
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

  const handleRoleChange = useCallback(
    (nextRole: AgentRole) => {
      const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
      const isRoleEnabled = roleEnabledByTask[nextRole] || activeSession?.role === nextRole;
      if (!isRoleEnabled) {
        return;
      }

      if (activeSession && isSessionWorking) {
        return;
      }
      updateQuery({
        agent: nextRole,
        scenario: firstScenario(nextRole),
        session: undefined,
        autostart: undefined,
      });
    },
    [activeSession, isSessionWorking, selectedTask, updateQuery],
  );

  const handleScenarioChange = useCallback(
    (nextScenario: string) => {
      updateQuery({ scenario: nextScenario, autostart: undefined });
    },
    [updateQuery],
  );

  const handleSelectAgent = useCallback(
    (opencodeAgent: string) => {
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel) {
            return null;
          }
          return {
            providerId: firstModel.providerId,
            modelId: firstModel.modelId,
            ...(firstModel.variants[0] ? { variant: firstModel.variants[0] } : {}),
          } satisfies AgentModelSelection;
        })();
      if (!baseSelection) {
        return;
      }
      applySelection({
        ...baseSelection,
        opencodeAgent,
      });
    },
    [applySelection, selectedModelSelection, selectionCatalog],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog) {
        return;
      }
      const model = selectionCatalog.models.find((entry) => entry.id === nextValue);
      if (!model) {
        return;
      }
      applySelection({
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(selectedModelSelection?.opencodeAgent
          ? { opencodeAgent: selectedModelSelection.opencodeAgent }
          : {}),
      });
    },
    [applySelection, selectedModelSelection?.opencodeAgent, selectionCatalog],
  );

  const handleSelectVariant = useCallback(
    (variant: string) => {
      if (!selectedModelSelection) {
        return;
      }
      applySelection({
        ...selectedModelSelection,
        variant,
      });
    },
    [applySelection, selectedModelSelection],
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
    onCreateTab: handleCreateTab,
    onCloseTab: handleCloseTab,
    agentStudioReady,
  };

  const activeTabValue = taskId || "__agent_studio_empty__";

  const roleEnabledByTask = useMemo(() => buildRoleEnabledMapForTask(selectedTask), [selectedTask]);
  const roleSelectionLocked = Boolean(activeSession && isSessionWorking);
  const roleOptions = useMemo(
    () =>
      ROLE_OPTIONS.map((entry) => ({
        ...entry,
        disabled: !(roleEnabledByTask[entry.role] || activeSession?.role === entry.role),
      })),
    [activeSession?.role, roleEnabledByTask],
  );

  const agentStudioHeaderModel: AgentStudioHeaderModel = {
    taskTitle: selectedTask?.title ?? null,
    sessionStatus: activeSession?.status ?? null,
    roleOptions,
    role,
    roleDisabled: roleSelectionLocked,
    onRoleChange: handleRoleChange,
    scenario,
    scenarioOptions,
    scenarioDisabled: roleSelectionLocked,
    onScenarioChange: handleScenarioChange,
    canKickoffNewSession,
    kickoffLabel,
    onKickoff: () => {
      void startScenarioKickoff();
    },
    isStarting,
    isSending,
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
