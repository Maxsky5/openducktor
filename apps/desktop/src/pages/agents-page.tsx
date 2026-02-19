import { resolveAgentAccentColor } from "@/components/features/agents/agent-accent-color";
import { AgentChatMessageCard } from "@/components/features/agents/agent-chat-message-card";
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents/catalog-select-options";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { TaskSelector } from "@/components/features/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComboboxOption } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import { loadRepoOpencodeCatalog } from "@/state/operations/opencode-catalog";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { TaskCard } from "@openblueprint/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openblueprint/core";
import { normalizeOdtWorkflowToolName } from "@openblueprint/core";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  CircleDotDashed,
  LoaderCircle,
  RefreshCcw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const ROLE_OPTIONS: Array<{
  role: AgentRole;
  label: string;
  icon: typeof Sparkles;
}> = [
  { role: "spec", label: "Spec", icon: Sparkles },
  { role: "planner", label: "Planner", icon: Bot },
  { role: "build", label: "Build", icon: Wrench },
  { role: "qa", label: "QA", icon: ShieldCheck },
];

const SCENARIOS_BY_ROLE: Record<AgentRole, AgentScenario[]> = {
  spec: ["spec_initial", "spec_revision"],
  planner: ["planner_initial", "planner_revision"],
  build: [
    "build_implementation_start",
    "build_after_qa_rejected",
    "build_after_human_request_changes",
  ],
  qa: ["qa_review"],
};

const SCENARIO_LABELS: Record<AgentScenario, string> = {
  spec_initial: "Initial Spec",
  spec_revision: "Revise Spec",
  planner_initial: "Initial Plan",
  planner_revision: "Revise Plan",
  build_implementation_start: "Start Implementation",
  build_after_qa_rejected: "Fix QA Rejection",
  build_after_human_request_changes: "Apply Human Changes",
  qa_review: "QA Review",
};

const kickoffPromptForScenario = (
  role: AgentRole,
  scenario: AgentScenario,
  taskId: string,
): string => {
  const taskInstruction = `Use taskId "${taskId}" for every odt_* tool call.`;
  if (role === "spec") {
    const base =
      scenario === "spec_revision"
        ? "Revise the current specification and call odt_set_spec with complete markdown when ready."
        : "Write the initial specification and call odt_set_spec with complete markdown when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "planner") {
    const base =
      scenario === "planner_revision"
        ? "Revise the current implementation plan and call odt_set_plan when ready."
        : "Create the initial implementation plan and call odt_set_plan when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "qa") {
    return `Perform QA review now and call exactly one of odt_qa_approved or odt_qa_rejected.\n${taskInstruction}`;
  }
  if (scenario === "build_after_qa_rejected") {
    return `Address all QA rejection findings and call odt_build_completed when done.\n${taskInstruction}`;
  }
  if (scenario === "build_after_human_request_changes") {
    return `Apply all human-requested changes and call odt_build_completed when done.\n${taskInstruction}`;
  }
  return `Start implementation now. Use odt_build_blocked/odt_build_resumed/odt_build_completed for workflow transitions.\n${taskInstruction}`;
};

const isTaskEligibleForRole = (task: TaskCard, role: AgentRole): boolean => {
  if (role === "spec") {
    return task.availableActions.includes("set_spec");
  }
  if (role === "planner") {
    return task.availableActions.includes("set_plan");
  }
  if (role === "build") {
    return (
      task.availableActions.includes("build_start") ||
      task.availableActions.includes("open_builder") ||
      task.status === "in_progress" ||
      task.status === "blocked" ||
      task.status === "ai_review" ||
      task.status === "human_review"
    );
  }
  return task.status === "ai_review";
};

const formatSessionTime = (iso: string): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

const formatDocumentUpdatedAt = (iso: string | null): string | null => {
  if (!iso) {
    return null;
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

const hasLabeledCodeFence = (markdown: string): boolean => {
  return markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown);
};

const isRole = (value: string | null): value is AgentRole =>
  value === "spec" || value === "planner" || value === "build" || value === "qa";

const isScenario = (value: string | null): value is AgentScenario =>
  value === "spec_initial" ||
  value === "spec_revision" ||
  value === "planner_initial" ||
  value === "planner_revision" ||
  value === "build_implementation_start" ||
  value === "build_after_qa_rejected" ||
  value === "build_after_human_request_changes" ||
  value === "qa_review";

const firstScenario = (role: AgentRole): AgentScenario => {
  const scenarios = SCENARIOS_BY_ROLE[role];
  const first = scenarios[0];
  if (first) {
    return first;
  }
  return "spec_initial";
};

const statusBadgeVariant = (status: string): "default" | "warning" | "danger" | "success" => {
  if (status === "running" || status === "starting") {
    return "warning";
  }
  if (status === "error") {
    return "danger";
  }
  if (status === "idle") {
    return "default";
  }
  return "success";
};

const NEW_SESSION_SENTINEL = "__new_session__";
const AGENT_STUDIO_CONTEXT_STORAGE_PREFIX = "openblueprint:agent-studio:context";
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})/;
const CHAT_AUTOSCROLL_THRESHOLD_PX = 48;

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

const isNearBottom = (element: HTMLElement): boolean => {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTOSCROLL_THRESHOLD_PX
  );
};

const toContextStorageKey = (repoPath: string): string =>
  `${AGENT_STUDIO_CONTEXT_STORAGE_PREFIX}:${repoPath}`;

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
  const { tasks } = useTasksState();
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
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string[][]>>({});
  const autoStartExecutedRef = useRef(new Set<string>());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const processedDocumentToolEventsRef = useRef(new Set<string>());
  const documentReloadAttemptsRef = useRef(new Map<string, number>());
  const restoredContextRepoRef = useRef<string | null>(null);

  const taskIdParam = searchParams.get("task") ?? "";
  const sessionParam = searchParams.get("session");
  const roleParam = searchParams.get("agent");
  const roleFromQuery: AgentRole = isRole(roleParam) ? roleParam : "spec";
  const scenarioParam = searchParams.get("scenario");
  const scenarioFromQuery: AgentScenario | undefined = isScenario(scenarioParam)
    ? scenarioParam
    : undefined;
  const autostart = searchParams.get("autostart") === "1";

  const selectedSessionById = useMemo(
    () => sessions.find((entry) => entry.sessionId === sessionParam) ?? null,
    [sessionParam, sessions],
  );
  const isComposingNewSession = sessionParam === NEW_SESSION_SENTINEL;

  const role: AgentRole = selectedSessionById?.role ?? roleFromQuery;
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

  const eligibleTasks = useMemo(() => {
    return tasks.filter((task) => isTaskEligibleForRole(task, role));
  }, [role, tasks]);

  const tasksForSelector = useMemo(() => {
    if (!selectedTask) {
      return eligibleTasks;
    }
    if (eligibleTasks.some((task) => task.id === selectedTask.id)) {
      return eligibleTasks;
    }
    return [selectedTask, ...eligibleTasks];
  }, [eligibleTasks, selectedTask]);

  const scenarios = SCENARIOS_BY_ROLE[role];
  const scenario =
    selectedSessionById?.scenario ??
    (scenarioFromQuery && scenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(role));

  const activeSession = useMemo(() => {
    if (isComposingNewSession) {
      return null;
    }
    if (selectedSessionById) {
      return selectedSessionById;
    }
    return sessions
      .filter((entry) => entry.taskId === taskId && entry.role === role)
      .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))[0];
  }, [isComposingNewSession, role, selectedSessionById, sessions, taskId]);

  const contextSessions = useMemo(() => {
    return sessions
      .filter((entry) => entry.taskId === taskId && entry.role === role)
      .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  }, [role, sessions, taskId]);

  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded, reloadDocument, applyDocumentUpdate } =
    useTaskDocuments(taskId || null, true);
  const documentContextKey = `${taskId}:${activeSession?.sessionId ?? ""}`;
  const refreshedTaskVersionRef = useRef<string | null>(null);

  useEffect(() => {
    void documentContextKey;
    processedDocumentToolEventsRef.current.clear();
    documentReloadAttemptsRef.current.clear();
    refreshedTaskVersionRef.current = null;
  }, [documentContextKey]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    void loadAgentSessions(taskId);
    ensureDocumentLoaded("spec");
    ensureDocumentLoaded("plan");
    ensureDocumentLoaded("qa");
  }, [ensureDocumentLoaded, loadAgentSessions, taskId]);

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

    const hasExplicitQuery =
      Boolean(searchParams.get("task")) ||
      Boolean(searchParams.get("session")) ||
      Boolean(searchParams.get("agent")) ||
      Boolean(searchParams.get("scenario")) ||
      Boolean(searchParams.get("autostart"));
    if (hasExplicitQuery) {
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
      const next = new URLSearchParams(searchParams);
      if (parsed.taskId && parsed.taskId.trim().length > 0) {
        next.set("task", parsed.taskId);
      }
      if (persistedRole) {
        next.set("agent", persistedRole);
      }
      if (
        persistedScenario &&
        (!persistedRole || SCENARIOS_BY_ROLE[persistedRole].includes(persistedScenario))
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
      sessionId: isComposingNewSession ? undefined : activeSession?.sessionId,
    };
    globalThis.localStorage.setItem(toContextStorageKey(activeRepo), JSON.stringify(payload));
  }, [activeRepo, activeSession?.sessionId, isComposingNewSession, role, scenario, taskId]);

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
    if (!sessionParam || selectedSessionById || sessionParam === NEW_SESSION_SENTINEL) {
      return;
    }
    void updateQuery({ session: undefined });
  }, [selectedSessionById, sessionParam, updateQuery]);

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

  const sessionOptions = useMemo<ComboboxOption[]>(() => {
    const options = contextSessions.map((entry) => ({
      value: entry.sessionId,
      label: `${SCENARIO_LABELS[entry.scenario]} · ${formatSessionTime(entry.startedAt)}`,
      description: `${SCENARIO_LABELS[entry.scenario]} · ${entry.status}`,
      searchKeywords: [entry.taskId, entry.role, entry.scenario, entry.status, entry.sessionId],
    }));
    if (!taskId) {
      return options;
    }
    return [
      {
        value: NEW_SESSION_SENTINEL,
        label: "Start Fresh Session",
        description: "Create a new session for this task/role on your next message.",
        searchKeywords: ["new", "fresh", "create", "session"],
      },
      ...options,
    ];
  }, [contextSessions, taskId]);

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
    if (!taskId || !agentStudioReady) {
      return undefined;
    }
    setIsStarting(true);
    try {
      const sessionId = await startAgentSession({ taskId, role, scenario, sendKickoff: false });
      if (selectionForNewSession) {
        updateAgentSessionModel(sessionId, selectionForNewSession);
      }
      await updateQuery({
        task: taskId,
        agent: role,
        scenario,
        session: sessionId,
        autostart: undefined,
      });
      return sessionId;
    } finally {
      setIsStarting(false);
    }
  }, [
    agentStudioReady,
    role,
    scenario,
    selectionForNewSession,
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
    if (!autostart || !activeRepo || !taskId || activeSession || !agentStudioReady) {
      return;
    }
    const key = `${taskId}:${role}:${scenario}`;
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

    const shouldStartNew = isComposingNewSession || !activeSession;
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
    } catch {
      if (!shouldStartNew && activeSession && targetSessionId === activeSession.sessionId) {
        const fallbackSessionId = await startSession();
        if (fallbackSessionId) {
          await sendAgentMessage(fallbackSessionId, message);
        }
      }
    } finally {
      setIsSending(false);
    }
  }, [
    activeSession,
    agentStudioReady,
    input,
    isComposingNewSession,
    isSending,
    isStarting,
    sendAgentMessage,
    startSession,
    taskId,
  ]);

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

  const activeMessageCount = activeSession?.messages.length ?? 0;
  const activeDraftText = activeSession?.draftAssistantText ?? "";
  const activeSessionStatus = activeSession?.status ?? "stopped";
  const isSessionWorking =
    Boolean(activeSession) &&
    (activeSessionStatus === "running" || activeSessionStatus === "starting" || isSending);
  const scrollTrigger = `${activeSessionStatus}:${activeMessageCount}:${activeDraftText.length}`;

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

  useEffect(() => {
    void scrollTrigger;
    const container = messagesContainerRef.current;
    if (!container || !isPinnedToBottom) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [isPinnedToBottom, scrollTrigger]);

  useEffect(() => {
    void activeSession?.sessionId;
    void taskId;
    setIsPinnedToBottom(true);
  }, [activeSession?.sessionId, taskId]);

  useEffect(() => {
    const pending = activeSession?.pendingQuestions ?? [];
    setQuestionDrafts((previous) => {
      const next: Record<string, string[][]> = {};
      let changed = false;

      for (const request of pending) {
        const existing = previous[request.requestId] ?? [];
        const requestDraft = request.questions.map((question, index) => {
          const current = existing[index] ?? [];
          if (question.multiple) {
            return current;
          }
          return current.slice(0, 1);
        });
        next[request.requestId] = requestDraft;
        if (
          !previous[request.requestId] ||
          previous[request.requestId]?.length !== requestDraft.length
        ) {
          changed = true;
        }
      }

      const previousKeys = Object.keys(previous);
      if (!changed && previousKeys.length === Object.keys(next).length) {
        return previous;
      }
      return next;
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

    for (const message of activeSession.messages) {
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
  }, [activeSession, applyDocumentUpdate, planDoc, qaDoc, reloadDocument, specDoc, taskId]);

  const canKickoffNewSession =
    agentStudioReady && Boolean(taskId) && (!activeSession || isComposingNewSession);

  return (
    <div className="grid h-[calc(100vh-2rem)] min-h-0 max-h-[calc(100vh-2rem)] gap-4 overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(420px,1fr)]">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="space-y-3 border-b border-slate-200 bg-white pb-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-xl">Agent Studio</CardTitle>
              <CardDescription>
                Chat-first workspace for Spec, Planner, Build, and QA orchestration.
              </CardDescription>
            </div>
            {activeSession ? (
              <Badge variant={statusBadgeVariant(activeSession.status)}>
                <CircleDotDashed className="mr-1 size-3" />
                {activeSession.status}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(280px,1fr)_auto]">
            <div className="min-w-0">
              <TaskSelector
                tasks={tasksForSelector}
                value={taskId}
                disabled={!agentStudioReady}
                onValueChange={(nextTaskId) => {
                  updateQuery({
                    task: nextTaskId || undefined,
                    session: undefined,
                    autostart: undefined,
                  });
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {ROLE_OPTIONS.map((entry) => {
                const Icon = entry.icon;
                const active = role === entry.role;
                return (
                  <Button
                    key={entry.role}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "ghost"}
                    className={cn("h-8", active ? "" : "hover:bg-white")}
                    disabled={!agentStudioReady}
                    onClick={() =>
                      updateQuery({
                        agent: entry.role,
                        scenario: firstScenario(entry.role),
                        session: undefined,
                        autostart: undefined,
                      })
                    }
                  >
                    <Icon className="size-3.5" />
                    {entry.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px_1fr]">
            <Combobox
              value={
                isComposingNewSession ? NEW_SESSION_SENTINEL : (activeSession?.sessionId ?? "")
              }
              options={sessionOptions}
              placeholder={
                sessionOptions.length > 0
                  ? "Select session (latest used by default)"
                  : "No session yet for this task/role"
              }
              searchPlaceholder="Search sessions..."
              emptyText="No matching session."
              disabled={!taskId || !agentStudioReady}
              onValueChange={(sessionId) => {
                if (sessionId === NEW_SESSION_SENTINEL) {
                  setInput("");
                  void updateQuery({
                    session: NEW_SESSION_SENTINEL,
                    autostart: undefined,
                  });
                  return;
                }
                const selected = sessions.find((entry) => entry.sessionId === sessionId);
                if (!selected) {
                  return;
                }
                updateQuery({
                  session: selected.sessionId,
                  task: selected.taskId,
                  agent: selected.role,
                  scenario: selected.scenario,
                  autostart: undefined,
                });
              }}
            />
            <Combobox
              value={scenario}
              options={scenarioOptions}
              placeholder="Select scenario"
              disabled={
                (Boolean(selectedSessionById) && !isComposingNewSession) || !agentStudioReady
              }
              onValueChange={(value) => updateQuery({ scenario: value, autostart: undefined })}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {selectedTask ? (
                <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
                  {selectedTask.title}
                </Badge>
              ) : (
                <span>Select a task to chat.</span>
              )}
              {canKickoffNewSession ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  disabled={isStarting || isSending || !taskId || !agentStudioReady}
                  onClick={() => void startScenarioKickoff()}
                >
                  {isStarting ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  {role === "spec" ? "Start Spec" : `Start ${SCENARIO_LABELS[scenario]}`}
                </Button>
              ) : null}
              <span>
                Sessions: <strong>{contextSessions.length}</strong>
              </span>
              <span>
                Messages: <strong>{activeSession?.messages.length ?? 0}</strong>
              </span>
              <span>
                Permissions: <strong>{activeSession?.pendingPermissions.length ?? 0}</strong>
              </span>
              <span>
                Questions: <strong>{activeSession?.pendingQuestions.length ?? 0}</strong>
              </span>
              {selectedSessionById ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    void updateQuery({ session: undefined, autostart: undefined });
                  }}
                >
                  Follow Latest
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 bg-slate-50/50 p-0">
          <div className="flex h-full min-h-0 flex-col">
            {!agentStudioReady ? (
              <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p className="min-w-0">{agentStudioBlockedReason}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-rose-300 bg-white text-rose-700 hover:bg-rose-100"
                  disabled={isLoadingChecks}
                  onClick={() => void refreshChecks()}
                >
                  <RefreshCcw className={cn("size-3.5", isLoadingChecks ? "animate-spin" : "")} />
                  Recheck
                </Button>
              </div>
            ) : null}

            <div
              ref={messagesContainerRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              onScroll={(event) => {
                setIsPinnedToBottom(isNearBottom(event.currentTarget));
              }}
            >
              {!activeSession ? (
                <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                  <p>
                    {taskId
                      ? "Send a message to start a new session automatically."
                      : "Select a task to begin."}
                  </p>
                  {canKickoffNewSession ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isStarting || isSending || !taskId || !agentStudioReady}
                      onClick={() => void startScenarioKickoff()}
                    >
                      {isStarting ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      {role === "spec" ? "Start Spec" : `Start ${SCENARIO_LABELS[scenario]}`}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {activeSession?.messages.map((message) => (
                <AgentChatMessageCard
                  key={message.id}
                  message={message}
                  sessionRole={activeSession.role}
                  sessionSelectedModel={activeSession.selectedModel}
                  sessionAgentColors={activeSessionAgentColors}
                />
              ))}

              {activeSession?.draftAssistantText ? (
                <article className="px-1 py-1 text-sm text-slate-700">
                  {(() => {
                    const roleDisplay =
                      ROLE_OPTIONS.find((entry) => entry.role === activeSession.role) ?? null;
                    const StreamingRoleIcon = roleDisplay?.icon ?? Bot;
                    return (
                      <header className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <StreamingRoleIcon className="size-3" />
                        {roleDisplay?.label ?? "Assistant"} (streaming)
                        <LoaderCircle className="size-3 animate-spin" />
                      </header>
                    );
                  })()}
                  <p className="whitespace-pre-wrap leading-6 text-slate-700">
                    {`${activeSession.draftAssistantText}▍`}
                  </p>
                </article>
              ) : null}

              {activeSession?.status === "running" && !activeSession?.draftAssistantText ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                  <LoaderCircle className="size-3.5 animate-spin text-slate-500" />
                  <Brain className="size-3.5 text-violet-600" />
                  Agent is thinking...
                </div>
              ) : null}
            </div>

            <form
              className="space-y-3 border-t border-slate-200 bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onSend();
              }}
            >
              <Textarea
                placeholder="# for agents · @ for files · / for commands"
                value={input}
                className="min-h-24 resize-none"
                onChange={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
              />

              <div className="grid gap-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,0.65fr)_auto]">
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Agent
                  </p>
                  <Combobox
                    value={selectedModelSelection?.opencodeAgent ?? ""}
                    options={agentOptions}
                    placeholder={isSelectionCatalogLoading ? "Loading agents..." : "Agent"}
                    disabled={
                      !taskId || isSelectionCatalogLoading || isStarting || !agentStudioReady
                    }
                    onValueChange={(opencodeAgent) => {
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
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Model
                  </p>
                  <Combobox
                    value={
                      selectedModelSelection
                        ? `${selectedModelSelection.providerId}/${selectedModelSelection.modelId}`
                        : ""
                    }
                    options={modelOptions}
                    groups={modelGroups}
                    placeholder={isSelectionCatalogLoading ? "Loading models..." : "Model"}
                    disabled={
                      !taskId || isSelectionCatalogLoading || isStarting || !agentStudioReady
                    }
                    onValueChange={(nextValue) => {
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
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Variant
                  </p>
                  <Combobox
                    value={selectedModelSelection?.variant ?? ""}
                    options={variantOptions}
                    placeholder={variantOptions.length > 0 ? "Variant" : "No variants"}
                    disabled={
                      !taskId || variantOptions.length === 0 || isStarting || !agentStudioReady
                    }
                    onValueChange={(variant) => {
                      if (!selectedModelSelection) {
                        return;
                      }
                      applySelection({
                        ...selectedModelSelection,
                        variant,
                      });
                    }}
                  />
                </div>

                <div className="flex items-end justify-end gap-2">
                  {activeSession && isSessionWorking && !isComposingNewSession ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full lg:w-auto"
                      disabled={!agentStudioReady}
                      onClick={() => void stopAgentSession(activeSession.sessionId)}
                    >
                      <Square className="size-3.5" />
                      Stop
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full lg:w-auto"
                    disabled={
                      isSending ||
                      isStarting ||
                      isSessionWorking ||
                      !taskId ||
                      input.trim().length === 0 ||
                      !agentStudioReady
                    }
                  >
                    {isSending ? (
                      <>
                        <LoaderCircle className="size-3.5 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <SendHorizontal className="size-3.5" />
                        Send
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <div className="grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-1">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Workflow Inbox</CardTitle>
            <CardDescription>
              Resolve permissions and questions emitted by the agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pending Permissions
              </h3>
              {activeSession?.pendingPermissions.length ? null : (
                <p className="text-sm text-slate-500">No pending permission requests.</p>
              )}
              {activeSession?.pendingPermissions.map((request) => (
                <div
                  key={request.requestId}
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-sm font-medium text-slate-800">{request.permission}</p>
                  <p className="text-xs text-slate-600">
                    {request.patterns.join(", ") || "No pattern"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!activeSession || !agentStudioReady}
                      onClick={() =>
                        activeSession
                          ? void replyAgentPermission(
                              activeSession.sessionId,
                              request.requestId,
                              "once",
                            )
                          : undefined
                      }
                    >
                      Allow Once
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!activeSession || !agentStudioReady}
                      onClick={() =>
                        activeSession
                          ? void replyAgentPermission(
                              activeSession.sessionId,
                              request.requestId,
                              "always",
                            )
                          : undefined
                      }
                    >
                      Always Allow
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={!activeSession || !agentStudioReady}
                      onClick={() =>
                        activeSession
                          ? void replyAgentPermission(
                              activeSession.sessionId,
                              request.requestId,
                              "reject",
                            )
                          : undefined
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pending Questions
              </h3>
              {activeSession?.pendingQuestions.length ? null : (
                <p className="text-sm text-slate-500">No pending questions.</p>
              )}
              {activeSession?.pendingQuestions.map((request) => (
                <div
                  key={request.requestId}
                  className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  {request.questions.map((question, index) => (
                    <div
                      key={`${request.requestId}:${question.header}:${index}`}
                      className="space-y-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {question.header}
                      </p>
                      <p className="text-sm font-medium text-slate-800">{question.question}</p>
                      <div className="flex flex-wrap gap-2">
                        {question.options.map((option) => (
                          <Button
                            key={`${request.requestId}:${question.header}:${option.label}`}
                            type="button"
                            size="sm"
                            disabled={!activeSession || !agentStudioReady}
                            variant={
                              questionDrafts[request.requestId]?.[index]?.includes(option.label)
                                ? "default"
                                : "outline"
                            }
                            onClick={() => {
                              setQuestionDrafts((previous) => {
                                const next = { ...previous };
                                const existing = next[request.requestId];
                                const current = existing
                                  ? existing.map((entry) => [...entry])
                                  : request.questions.map(() => []);
                                const selected = [...(current[index] ?? [])];
                                const isSelected = selected.includes(option.label);
                                let nextSelected = selected;

                                if (question.multiple) {
                                  nextSelected = isSelected
                                    ? selected.filter((entry) => entry !== option.label)
                                    : [...selected, option.label];
                                } else {
                                  nextSelected = isSelected ? [] : [option.label];
                                }

                                current[index] = nextSelected;
                                next[request.requestId] = current;
                                return next;
                              });
                            }}
                          >
                            <CheckCircle2 className="size-3.5" />
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        !agentStudioReady ||
                        !activeSession ||
                        request.questions.some((question, index) => {
                          const selected = questionDrafts[request.requestId]?.[index] ?? [];
                          if (question.custom && question.options.length === 0) {
                            return false;
                          }
                          return selected.length === 0;
                        })
                      }
                      onClick={() => {
                        if (!activeSession) {
                          return;
                        }
                        const answers = request.questions.map((question, index) => {
                          const selected = questionDrafts[request.requestId]?.[index] ?? [];
                          if (selected.length > 0) {
                            return selected;
                          }
                          if (question.options[0]?.label) {
                            return [question.options[0].label];
                          }
                          return [];
                        });
                        void answerAgentQuestion(
                          activeSession.sessionId,
                          request.requestId,
                          answers,
                        );
                      }}
                    >
                      Submit Answers
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Documents</CardTitle>
            <CardDescription>Live task artifacts for the selected task.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[40vh] space-y-3 overflow-y-auto">
            <details className="rounded-lg border border-slate-200 bg-white" open>
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>Spec</span>
                <span className="text-[11px] normal-case text-slate-500">
                  {formatDocumentUpdatedAt(specDoc.updatedAt) ?? "Not set"}
                </span>
              </summary>
              <div className="border-t border-slate-200 p-3">
                {specDoc.markdown.trim().length > 0 ? (
                  <MarkdownRenderer
                    markdown={specDoc.markdown}
                    variant="document"
                    premiumCodeBlocks={hasLabeledCodeFence(specDoc.markdown)}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No spec document yet.</p>
                )}
              </div>
            </details>

            <details className="rounded-lg border border-slate-200 bg-white" open>
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>Implementation Plan</span>
                <span className="text-[11px] normal-case text-slate-500">
                  {formatDocumentUpdatedAt(planDoc.updatedAt) ?? "Not set"}
                </span>
              </summary>
              <div className="border-t border-slate-200 p-3">
                {planDoc.markdown.trim().length > 0 ? (
                  <MarkdownRenderer
                    markdown={planDoc.markdown}
                    variant="document"
                    premiumCodeBlocks={hasLabeledCodeFence(planDoc.markdown)}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No implementation plan yet.</p>
                )}
              </div>
            </details>

            <details className="rounded-lg border border-slate-200 bg-white" open>
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>QA Report</span>
                <span className="text-[11px] normal-case text-slate-500">
                  {formatDocumentUpdatedAt(qaDoc.updatedAt) ?? "Not set"}
                </span>
              </summary>
              <div className="border-t border-slate-200 p-3">
                {qaDoc.markdown.trim().length > 0 ? (
                  <MarkdownRenderer
                    markdown={qaDoc.markdown}
                    variant="document"
                    premiumCodeBlocks={hasLabeledCodeFence(qaDoc.markdown)}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No QA report yet.</p>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
