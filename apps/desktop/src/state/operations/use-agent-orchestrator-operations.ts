import { errorMessage } from "@/lib/errors";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { OpencodeSdkAdapter } from "@openblueprint/adapters-opencode-sdk";
import type { AgentSessionRecord, RunSummary, TaskCard } from "@openblueprint/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  type AgentSessionHistoryMessage,
  type AgentSessionTodoItem,
  buildAgentSystemPrompt,
  isOdtWorkflowMutationToolName,
} from "@openblueprint/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";
import { isMutatingPermission } from "./permission-policy";

type UseAgentOrchestratorOperationsArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string) => Promise<void>;
};

type UseAgentOrchestratorOperationsResult = {
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string) => Promise<void>;
  startAgentSession: (input: {
    taskId: string;
    role: AgentRole;
    scenario?: AgentScenario;
    sendKickoff?: boolean;
  }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

type RuntimeInfo = {
  runtimeId: string | null;
  runId: string | null;
  baseUrl: string;
  workingDirectory: string;
};

const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

const runningStates = new Set(["starting", "running", "blocked", "awaiting_done_confirmation"]);

const now = (): string => new Date().toISOString();
const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

const sanitizeStreamingText = (value: string): string => {
  return value.replace(/\n{3,}/g, "\n\n").trimStart();
};

const isDuplicateAssistantMessage = (
  messages: AgentChatMessage[],
  incomingContent: string,
  incomingTimestamp: string,
): boolean => {
  const normalizedIncoming = incomingContent.trim();
  if (normalizedIncoming.length === 0) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry) {
      continue;
    }
    if (entry.role !== "assistant") {
      continue;
    }

    const normalizedExisting = entry.content.trim();
    if (normalizedExisting !== normalizedIncoming) {
      return false;
    }

    if (entry.timestamp === incomingTimestamp) {
      return true;
    }

    const existingEpoch = Date.parse(entry.timestamp);
    const incomingEpoch = Date.parse(incomingTimestamp);
    if (Number.isNaN(existingEpoch) || Number.isNaN(incomingEpoch)) {
      return false;
    }
    return Math.abs(incomingEpoch - existingEpoch) <= 2_000;
  }

  return false;
};

const inferScenario = (
  role: AgentRole,
  task: TaskCard,
  docs: {
    specMarkdown: string;
    planMarkdown: string;
    qaMarkdown: string;
  },
): AgentScenario => {
  if (role === "spec") {
    return docs.specMarkdown.trim().length > 0 || task.status === "spec_ready"
      ? "spec_revision"
      : "spec_initial";
  }
  if (role === "planner") {
    return docs.planMarkdown.trim().length > 0 ? "planner_revision" : "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }

  if (docs.qaMarkdown.trim().length > 0 && task.status === "in_progress") {
    return "build_after_qa_rejected";
  }

  if (task.status === "in_progress" && docs.qaMarkdown.trim().length === 0) {
    return "build_after_human_request_changes";
  }

  return "build_implementation_start";
};

const kickoffPrompt = (role: AgentRole, scenario: AgentScenario, taskId: string): string => {
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

const pickDefaultModel = (catalog: AgentModelCatalog): AgentModelSelection | null => {
  if (catalog.models.length === 0) {
    return null;
  }

  for (const model of catalog.models) {
    const providerDefault = catalog.defaultModelsByProvider[model.providerId];
    if (providerDefault && providerDefault === model.modelId) {
      return {
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
      };
    }
  }

  const first = catalog.models[0];
  if (!first) {
    return null;
  }

  return {
    providerId: first.providerId,
    modelId: first.modelId,
    ...(first.variants[0] ? { variant: first.variants[0] } : {}),
  };
};

const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
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
      catalog.agents.some((agent) => agent.name === selection.opencodeAgent),
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

const upsertMessage = (
  messages: AgentChatMessage[],
  message: AgentChatMessage,
): AgentChatMessage[] => {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) {
    return [...messages, message];
  }

  const next = [...messages];
  next[index] = {
    ...next[index],
    ...message,
  };
  return next;
};

const formatToolContent = (part: {
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  title?: string;
  output?: string;
  error?: string;
}): string => {
  const title = part.title ? ` (${part.title})` : "";
  if (part.status === "completed") {
    return `Tool ${part.tool}${title} completed${part.output ? `\n\n${part.output}` : ""}`;
  }
  if (part.status === "error") {
    return `Tool ${part.tool}${title} failed${part.error ? `\n\n${part.error}` : ""}`;
  }
  if (part.status === "running") {
    return `Tool ${part.tool}${title} running...`;
  }
  return `Tool ${part.tool}${title} queued...`;
};

const normalizeToolInput = (
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!input) {
    return undefined;
  }
  return Object.keys(input).length > 0 ? input : undefined;
};

const normalizeToolText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const TODO_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const TODO_PRIORITIES = new Set(["high", "medium", "low"]);

const normalizeSessionTodo = (value: unknown): AgentSessionTodoItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!id || !content) {
    return null;
  }

  const rawStatus = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  const rawPriority =
    typeof record.priority === "string" ? record.priority.trim().toLowerCase() : "";
  const status = TODO_STATUSES.has(rawStatus) ? rawStatus : "pending";
  const priority = TODO_PRIORITIES.has(rawPriority) ? rawPriority : "medium";

  return {
    id,
    content,
    status: status as AgentSessionTodoItem["status"],
    priority: priority as AgentSessionTodoItem["priority"],
  };
};

const normalizeSessionTodoList = (payload: unknown): AgentSessionTodoItem[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry) => normalizeSessionTodo(entry))
    .filter((entry): entry is AgentSessionTodoItem => entry !== null);
};

const isTodoToolName = (tool: string): boolean => {
  const normalized = tool.trim().toLowerCase();
  return (
    normalized === "todoread" ||
    normalized === "todowrite" ||
    normalized.endsWith("_todoread") ||
    normalized.endsWith("_todowrite")
  );
};

const parseTodosFromToolOutput = (output: string | undefined): AgentSessionTodoItem[] | null => {
  if (!output || output.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeSessionTodoList(parsed);
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.todos)) {
        return normalizeSessionTodoList(record.todos);
      }
    }
    return null;
  } catch {
    return null;
  }
};

const normalizeSessionErrorMessage = (value: string): string => {
  const trimmed = value.trim();
  const withoutQuotes = trimmed
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .trim();

  if (!withoutQuotes.startsWith("{")) {
    return withoutQuotes;
  }

  try {
    const parsed = JSON.parse(withoutQuotes) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return withoutQuotes;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message.trim();
    }
    const nestedError = record.error;
    if (
      nestedError &&
      typeof nestedError === "object" &&
      typeof (nestedError as Record<string, unknown>).message === "string"
    ) {
      return String((nestedError as Record<string, unknown>).message).trim();
    }
    return withoutQuotes;
  } catch {
    return withoutQuotes;
  }
};

const normalizeRetryStatusMessage = (value: string): string => {
  const normalized = normalizeSessionErrorMessage(value);
  if (!normalized.startsWith("{")) {
    return normalized;
  }

  const messageMatch = normalized.match(/message["':\s]+([^",}]+|"[^"]+")/i);
  if (messageMatch?.[1]) {
    return messageMatch[1].replace(/^"|"$/g, "").trim();
  }
  return normalized;
};

const toAssistantMessageMeta = (
  session: AgentSessionState,
  durationMs?: number,
): Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }> => {
  return {
    kind: "assistant",
    agentRole: session.role,
    ...(session.selectedModel?.providerId ? { providerId: session.selectedModel.providerId } : {}),
    ...(session.selectedModel?.modelId ? { modelId: session.selectedModel.modelId } : {}),
    ...(session.selectedModel?.variant ? { variant: session.selectedModel.variant } : {}),
    ...(session.selectedModel?.opencodeAgent
      ? { opencodeAgent: session.selectedModel.opencodeAgent }
      : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
  };
};

const finalizeDraftAssistantMessage = (
  session: AgentSessionState,
  timestamp: string,
  durationMs?: number,
): AgentSessionState => {
  const draft = session.draftAssistantText.trim();
  if (draft.length === 0) {
    return session;
  }

  const lastMessage = session.messages[session.messages.length - 1];
  const alreadyAppended = lastMessage?.role === "assistant" && lastMessage.content.trim() === draft;
  if (alreadyAppended) {
    const nextMessages = [...session.messages];
    const lastIndex = nextMessages.length - 1;
    const existing = nextMessages[lastIndex];
    if (existing && (!existing.meta || existing.meta.kind !== "assistant")) {
      nextMessages[lastIndex] = {
        ...existing,
        meta: toAssistantMessageMeta(session, durationMs),
      };
    }
    return {
      ...session,
      draftAssistantText: "",
      messages: nextMessages,
    };
  }

  return {
    ...session,
    draftAssistantText: "",
    messages: [
      ...session.messages,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: draft,
        timestamp,
        meta: toAssistantMessageMeta(session, durationMs),
      },
    ],
  };
};

const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.variant ? { variant: selection.variant } : {}),
    ...(selection.opencodeAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};

const toPersistedSessionRecord = (
  session: AgentSessionState,
  updatedAt: string,
): AgentSessionRecord => ({
  sessionId: session.sessionId,
  externalSessionId: session.externalSessionId,
  taskId: session.taskId,
  role: session.role,
  scenario: session.scenario,
  status: session.status,
  startedAt: session.startedAt,
  updatedAt,
  ...(session.status === "stopped" || session.status === "error" ? { endedAt: updatedAt } : {}),
  runtimeId: session.runtimeId ?? undefined,
  runId: session.runId ?? undefined,
  baseUrl: session.baseUrl,
  workingDirectory: session.workingDirectory,
  selectedModel: session.selectedModel ?? undefined,
});

const fromPersistedSessionRecord = (session: AgentSessionRecord): AgentSessionState => {
  const normalizedStatus =
    session.status === "starting" || session.status === "running" ? "stopped" : session.status;
  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId,
    taskId: session.taskId,
    role: session.role,
    scenario: session.scenario,
    status: normalizedStatus,
    startedAt: session.startedAt,
    runtimeId: session.runtimeId ?? null,
    runId: session.runId ?? null,
    baseUrl: session.baseUrl,
    workingDirectory: session.workingDirectory,
    messages: [],
    draftAssistantText: "",
    pendingPermissions: [],
    pendingQuestions: [],
    todos: [],
    modelCatalog: null,
    selectedModel: normalizePersistedSelection(session.selectedModel),
    isLoadingModelCatalog: true,
  };
};

const historyToChatMessages = (history: AgentSessionHistoryMessage[]): AgentChatMessage[] => {
  const next: AgentChatMessage[] = [];

  for (const message of history) {
    for (const part of message.parts) {
      if (part.kind === "reasoning") {
        if (part.text.trim().length === 0) {
          continue;
        }
        next.push({
          id: `history:thinking:${message.messageId}:${part.partId}`,
          role: "thinking",
          content: part.text,
          timestamp: message.timestamp,
          meta: {
            kind: "reasoning",
            partId: part.partId,
            completed: part.completed,
          },
        });
        continue;
      }

      if (part.kind === "tool") {
        const input = normalizeToolInput(part.input);
        const output = normalizeToolText(part.output);
        const error = normalizeToolText(part.error);
        next.push({
          id: `history:tool:${message.messageId}:${part.partId}`,
          role: "tool",
          content: formatToolContent(part),
          timestamp: message.timestamp,
          meta: {
            kind: "tool",
            partId: part.partId,
            callId: part.callId,
            tool: part.tool,
            status: part.status,
            ...(part.title ? { title: part.title } : {}),
            ...(input ? { input } : {}),
            ...(output ? { output } : {}),
            ...(error ? { error } : {}),
            ...(part.metadata ? { metadata: part.metadata } : {}),
            ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
            ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
          },
        });
        continue;
      }

      if (part.kind === "subtask") {
        next.push({
          id: `history:subtask:${message.messageId}:${part.partId}`,
          role: "system",
          content: `Subtask (${part.agent}): ${part.description}`,
          timestamp: message.timestamp,
          meta: {
            kind: "subtask",
            partId: part.partId,
            agent: part.agent,
            prompt: part.prompt,
            description: part.description,
          },
        });
      }
    }

    const content = message.text.trim();
    if (content.length > 0) {
      next.push({
        id: `history:text:${message.messageId}`,
        role: message.role,
        content,
        timestamp: message.timestamp,
      });
    }
  }

  return next;
};

export function useAgentOrchestratorOperations({
  activeRepo,
  tasks,
  runs,
  refreshTaskData,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const [sessionsById, setSessionsById] = useState<Record<string, AgentSessionState>>({});
  const sessionsRef = useRef<Record<string, AgentSessionState>>({});
  const taskRef = useRef<TaskCard[]>(tasks);
  const runsRef = useRef(runs);
  const previousRepoRef = useRef<string | null>(null);
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());
  const draftRawBySessionRef = useRef<Record<string, string>>({});
  const draftSourceBySessionRef = useRef<Record<string, "delta" | "part">>({});
  const turnStartedAtBySessionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    sessionsRef.current = sessionsById;
  }, [sessionsById]);

  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    if (previousRepoRef.current === activeRepo) {
      return;
    }
    previousRepoRef.current = activeRepo;

    const unsubs = [...unsubscribersRef.current.values()];
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
    unsubscribersRef.current.clear();
    draftRawBySessionRef.current = {};
    draftSourceBySessionRef.current = {};
    turnStartedAtBySessionRef.current = {};
    sessionsRef.current = {};
    setSessionsById({});
  }, [activeRepo]);

  const adapter = useMemo(() => new OpencodeSdkAdapter(), []);

  const persistSessionSnapshot = useCallback(
    async (session: AgentSessionState): Promise<void> => {
      if (!activeRepo) {
        return;
      }
      const updatedAt = now();
      await host.agentSessionUpsert(
        activeRepo,
        session.taskId,
        toPersistedSessionRecord(session, updatedAt),
      );
    },
    [activeRepo],
  );

  const updateSession = useCallback(
    (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: { persist?: boolean },
    ): void => {
      const currentSessions = sessionsRef.current;
      const current = currentSessions[sessionId];
      if (!current) {
        return;
      }
      const nextSession = updater(current);
      const nextSessions = {
        ...currentSessions,
        [sessionId]: nextSession,
      };
      sessionsRef.current = nextSessions;
      setSessionsById(nextSessions);

      if (options?.persist !== false) {
        void persistSessionSnapshot(nextSession).catch(() => undefined);
      }
    },
    [persistSessionSnapshot],
  );

  const resolveTurnDurationMs = useCallback(
    (
      sessionId: string,
      timestamp: string,
      messages: AgentChatMessage[] = [],
    ): number | undefined => {
      const startedAt = turnStartedAtBySessionRef.current[sessionId];
      const parsedTimestamp = Date.parse(timestamp);
      const endedAt = Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;
      if (typeof startedAt !== "number") {
        const latestUserMessage = [...messages].reverse().find((entry) => entry.role === "user");
        if (!latestUserMessage) {
          return undefined;
        }
        const userTimestamp = Date.parse(latestUserMessage.timestamp);
        if (Number.isNaN(userTimestamp) || endedAt < userTimestamp) {
          return undefined;
        }
        return Math.max(0, endedAt - userTimestamp);
      }
      return Math.max(0, endedAt - startedAt);
    },
    [],
  );

  const clearTurnDuration = useCallback((sessionId: string): void => {
    delete turnStartedAtBySessionRef.current[sessionId];
  }, []);

  const loadSessionModelCatalog = useCallback(
    async (sessionId: string, baseUrl: string, workingDirectory: string): Promise<void> => {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          isLoadingModelCatalog: true,
        }),
        { persist: false },
      );

      try {
        const catalog = await adapter.listAvailableModels({
          baseUrl,
          workingDirectory,
        });
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            modelCatalog: catalog,
            selectedModel:
              normalizeSelectionForCatalog(catalog, current.selectedModel) ??
              pickDefaultModel(catalog),
            isLoadingModelCatalog: false,
          }),
          { persist: false },
        );
      } catch (error) {
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            isLoadingModelCatalog: false,
            messages: upsertMessage(current.messages, {
              id: `model-catalog:${sessionId}`,
              role: "system",
              content: `Model catalog unavailable: ${errorMessage(error)}`,
              timestamp: now(),
            }),
          }),
          { persist: false },
        );
      }
    },
    [adapter, updateSession],
  );

  const loadSessionTodos = useCallback(
    async (
      sessionId: string,
      baseUrl: string,
      workingDirectory: string,
      externalSessionId: string,
    ): Promise<void> => {
      const todos = await adapter.loadSessionTodos({
        baseUrl,
        workingDirectory,
        externalSessionId,
      });
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          todos,
        }),
        { persist: false },
      );
    },
    [adapter, updateSession],
  );

  const loadAgentSessions = useCallback(
    async (taskId: string): Promise<void> => {
      if (!activeRepo || taskId.trim().length === 0) {
        return;
      }

      const persisted = await host.agentSessionsList(activeRepo, taskId);
      const existingIds = new Set(Object.keys(sessionsRef.current));
      const recordsToHydrate = persisted.filter((record) => !existingIds.has(record.sessionId));
      setSessionsById((current) => {
        const next = { ...current };
        for (const record of persisted) {
          if (next[record.sessionId]) {
            continue;
          }
          next[record.sessionId] = fromPersistedSessionRecord(record);
        }
        sessionsRef.current = next;
        return next;
      });

      if (recordsToHydrate.length === 0) {
        const existingSessions = Object.values(sessionsRef.current).filter(
          (entry) => entry.taskId === taskId && !entry.modelCatalog && !entry.isLoadingModelCatalog,
        );
        for (const session of existingSessions) {
          if (!session.baseUrl || !session.workingDirectory) {
            continue;
          }
          void loadSessionTodos(
            session.sessionId,
            session.baseUrl,
            session.workingDirectory,
            session.externalSessionId,
          );
          void loadSessionModelCatalog(
            session.sessionId,
            session.baseUrl,
            session.workingDirectory,
          );
        }
        return;
      }

      const requiresWorkspaceRuntime = recordsToHydrate.some(
        (record) => record.role === "spec" || record.role === "planner",
      );
      const workspaceRuntime = requiresWorkspaceRuntime
        ? await host.opencodeRepoRuntimeEnsure(activeRepo).catch(() => null)
        : null;

      await Promise.all(
        recordsToHydrate.map(async (record) => {
          const baseUrl =
            (record.role === "spec" || record.role === "planner") && workspaceRuntime
              ? toBaseUrl(workspaceRuntime.port)
              : record.baseUrl;
          const workingDirectory =
            (record.role === "spec" || record.role === "planner") && workspaceRuntime
              ? workspaceRuntime.workingDirectory
              : record.workingDirectory;
          const existingSession = sessionsRef.current[record.sessionId];
          if (existingSession && existingSession.messages.length > 0) {
            updateSession(
              record.sessionId,
              (current) => ({
                ...current,
                baseUrl,
                workingDirectory,
              }),
              { persist: false },
            );
            void loadSessionTodos(
              record.sessionId,
              baseUrl,
              workingDirectory,
              record.externalSessionId,
            );
            void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory);
            return;
          }

          const task = taskRef.current.find((entry) => entry.id === record.taskId);
          let preludeMessages: AgentChatMessage[] = [
            {
              id: `history:session-start:${record.sessionId}`,
              role: "system",
              content: `Session started (${record.role} - ${record.scenario})`,
              timestamp: record.startedAt,
            },
          ];

          if (task) {
            try {
              const [specMarkdown, planMarkdown, qaMarkdown] = await Promise.all([
                host
                  .specGet(activeRepo, record.taskId)
                  .then((doc) => doc.markdown)
                  .catch(() => ""),
                host
                  .planGet(activeRepo, record.taskId)
                  .then((doc) => doc.markdown)
                  .catch(() => ""),
                host
                  .qaGetReport(activeRepo, record.taskId)
                  .then((doc) => doc.markdown)
                  .catch(() => ""),
              ]);
              const systemPrompt = buildAgentSystemPrompt({
                role: record.role,
                scenario: record.scenario,
                task: {
                  taskId: task.id,
                  title: task.title,
                  issueType: task.issueType,
                  status: task.status,
                  qaRequired: task.aiReviewEnabled,
                  description: task.description,
                  acceptanceCriteria: task.acceptanceCriteria,
                  specMarkdown,
                  planMarkdown,
                  latestQaReportMarkdown: qaMarkdown,
                },
              });
              preludeMessages = [
                ...preludeMessages,
                {
                  id: `history:system-prompt:${record.sessionId}`,
                  role: "system",
                  content: `System prompt:\n\n${systemPrompt}`,
                  timestamp: record.startedAt,
                },
              ];
            } catch {
              // Keep session prelude even if prompt reconstruction fails.
            }
          }

          try {
            const history = await adapter.loadSessionHistory({
              baseUrl,
              workingDirectory,
              externalSessionId: record.externalSessionId,
              limit: 2000,
            });
            updateSession(
              record.sessionId,
              (current) => ({
                ...current,
                baseUrl,
                workingDirectory,
                messages: [...preludeMessages, ...historyToChatMessages(history)],
              }),
              { persist: false },
            );
            void loadSessionTodos(
              record.sessionId,
              baseUrl,
              workingDirectory,
              record.externalSessionId,
            );
            void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory);
          } catch {
            // Ignore missing/unavailable external history; metadata pointer remains persisted.
            void loadSessionTodos(
              record.sessionId,
              baseUrl,
              workingDirectory,
              record.externalSessionId,
            );
            void loadSessionModelCatalog(record.sessionId, baseUrl, workingDirectory);
          }
        }),
      );
    },
    [activeRepo, adapter, loadSessionModelCatalog, loadSessionTodos, updateSession],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = adapter.subscribeEvents(sessionId, (event) => {
        if (event.type === "session_started") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "running",
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: event.message,
                timestamp: event.timestamp,
              },
            ],
          }));
          return;
        }

        if (event.type === "assistant_delta") {
          if (draftSourceBySessionRef.current[sessionId] === "part") {
            return;
          }
          draftSourceBySessionRef.current[sessionId] = "delta";
          const nextRaw = `${draftRawBySessionRef.current[sessionId] ?? ""}${event.delta}`;
          draftRawBySessionRef.current[sessionId] = nextRaw;
          updateSession(
            sessionId,
            (current) => ({
              ...current,
              status: "running",
              draftAssistantText: sanitizeStreamingText(nextRaw),
            }),
            { persist: false },
          );
          return;
        }

        if (event.type === "assistant_part") {
          const part = event.part;
          const streamMessageKey = `${part.messageId}:${part.partId}`;
          if (part.kind === "text") {
            if (!part.synthetic) {
              draftSourceBySessionRef.current[sessionId] = "part";
              draftRawBySessionRef.current[sessionId] = part.text;
              updateSession(
                sessionId,
                (current) => ({
                  ...current,
                  status: "running",
                  draftAssistantText: sanitizeStreamingText(part.text),
                }),
                { persist: false },
              );
            }
            return;
          }

          if (part.kind === "reasoning") {
            updateSession(
              sessionId,
              (current) => {
                const messageId = `thinking:${streamMessageKey}`;
                const existingMessage = current.messages.find((entry) => entry.id === messageId);
                const nextContent =
                  part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
                if (nextContent.trim().length === 0) {
                  return {
                    ...current,
                    status: "running",
                  };
                }

                return {
                  ...current,
                  status: "running",
                  messages: upsertMessage(current.messages, {
                    id: messageId,
                    role: "thinking",
                    content: nextContent,
                    timestamp: event.timestamp,
                    meta: {
                      kind: "reasoning",
                      partId: part.partId,
                      completed: part.completed,
                    },
                  }),
                };
              },
              { persist: false },
            );
            return;
          }

          if (part.kind === "tool") {
            const input = normalizeToolInput(part.input);
            const output = normalizeToolText(part.output);
            const error = normalizeToolText(part.error);
            const todoUpdateFromOutput =
              isTodoToolName(part.tool) && part.status === "completed"
                ? parseTodosFromToolOutput(output)
                : null;
            let shouldRefreshTaskData = false;
            updateSession(
              sessionId,
              (current) => {
                const messageId = `tool:${streamMessageKey}`;
                const existing = current.messages.find((entry) => entry.id === messageId);
                const previousStatus =
                  existing?.meta?.kind === "tool" ? existing.meta.status : undefined;
                if (
                  isOdtWorkflowMutationToolName(part.tool) &&
                  part.status === "completed" &&
                  previousStatus !== "completed"
                ) {
                  shouldRefreshTaskData = true;
                }

                return {
                  ...current,
                  status: "running",
                  ...(todoUpdateFromOutput ? { todos: todoUpdateFromOutput } : {}),
                  messages: upsertMessage(current.messages, {
                    id: messageId,
                    role: "tool",
                    content: formatToolContent(part),
                    timestamp: event.timestamp,
                    meta: {
                      kind: "tool",
                      partId: part.partId,
                      callId: part.callId,
                      tool: part.tool,
                      status: part.status,
                      ...(part.title ? { title: part.title } : {}),
                      ...(input ? { input } : {}),
                      ...(output ? { output } : {}),
                      ...(error ? { error } : {}),
                      ...(part.metadata ? { metadata: part.metadata } : {}),
                      ...(typeof part.startedAtMs === "number"
                        ? { startedAtMs: part.startedAtMs }
                        : {}),
                      ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
                    },
                  }),
                };
              },
              { persist: false },
            );
            if (shouldRefreshTaskData) {
              void refreshTaskData(repoPath).catch(() => undefined);
            }
            return;
          }

          if (part.kind === "subtask") {
            updateSession(
              sessionId,
              (current) => ({
                ...current,
                status: "running",
                messages: upsertMessage(current.messages, {
                  id: `subtask:${streamMessageKey}`,
                  role: "system",
                  content: `Subtask (${part.agent}): ${part.description}`,
                  timestamp: event.timestamp,
                  meta: {
                    kind: "subtask",
                    partId: part.partId,
                    agent: part.agent,
                    prompt: part.prompt,
                    description: part.description,
                  },
                }),
              }),
              { persist: false },
            );
          }
          return;
        }

        if (event.type === "assistant_message") {
          delete draftRawBySessionRef.current[sessionId];
          delete draftSourceBySessionRef.current[sessionId];
          updateSession(sessionId, (current) => {
            const messageAlreadyPresent = isDuplicateAssistantMessage(
              current.messages,
              event.message,
              event.timestamp,
            );
            const durationMs = resolveTurnDurationMs(sessionId, event.timestamp, current.messages);
            return {
              ...current,
              draftAssistantText: "",
              messages: messageAlreadyPresent
                ? current.messages
                : [
                    ...current.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      content: event.message,
                      timestamp: event.timestamp,
                      meta: toAssistantMessageMeta(current, durationMs),
                    },
                  ],
            };
          });
          return;
        }

        if (event.type === "session_status") {
          const status = event.status;
          if (status.type === "busy") {
            updateSession(
              sessionId,
              (current) =>
                current.status === "error"
                  ? current
                  : {
                      ...current,
                      status: "running",
                    },
              { persist: false },
            );
            return;
          }
          if (status.type === "retry") {
            const retryMessage = normalizeRetryStatusMessage(status.message);
            updateSession(
              sessionId,
              (current) =>
                current.status === "error"
                  ? current
                  : {
                      ...current,
                      status: "running",
                      messages: upsertMessage(current.messages, {
                        id: `retry:${status.attempt}`,
                        role: "system",
                        content: `Retry ${status.attempt}: ${retryMessage}`,
                        timestamp: event.timestamp,
                      }),
                    },
              { persist: false },
            );
            return;
          }
          updateSession(sessionId, (current) => ({
            ...finalizeDraftAssistantMessage(
              current,
              event.timestamp,
              resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
            ),
            ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
          }));
          clearTurnDuration(sessionId);
          return;
        }

        if (event.type === "permission_required") {
          const role = sessionsRef.current[sessionId]?.role;
          if (
            role &&
            READ_ONLY_ROLES.has(role) &&
            isMutatingPermission(event.permission, event.patterns, event.metadata)
          ) {
            void adapter
              .replyPermission({
                sessionId,
                requestId: event.requestId,
                reply: "reject",
                message: `Rejected by OpenBlueprint ${role} read-only policy.`,
              })
              .catch(() => undefined);

            updateSession(sessionId, (current) => ({
              ...current,
              messages: [
                ...current.messages,
                {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Auto-rejected mutating permission (${event.permission}) for ${role} session.`,
                  timestamp: event.timestamp,
                },
              ],
            }));
            return;
          }

          updateSession(sessionId, (current) => ({
            ...current,
            pendingPermissions: [
              ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
              {
                requestId: event.requestId,
                permission: event.permission,
                patterns: event.patterns,
                ...(event.metadata ? { metadata: event.metadata } : {}),
              },
            ],
          }));
          return;
        }

        if (event.type === "question_required") {
          updateSession(sessionId, (current) => ({
            ...current,
            pendingQuestions: [
              ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
              {
                requestId: event.requestId,
                questions: event.questions,
              },
            ],
          }));
          return;
        }

        if (event.type === "session_todos_updated") {
          updateSession(
            sessionId,
            (current) => ({
              ...current,
              todos: event.todos,
            }),
            { persist: false },
          );
          return;
        }

        if (event.type === "session_error") {
          delete draftRawBySessionRef.current[sessionId];
          delete draftSourceBySessionRef.current[sessionId];
          const sessionErrorMessage = normalizeSessionErrorMessage(event.message);
          updateSession(sessionId, (current) => {
            const finalized = finalizeDraftAssistantMessage(
              current,
              event.timestamp,
              resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
            );
            return {
              ...finalized,
              status: "error",
              messages: [
                ...finalized.messages,
                {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Session error: ${sessionErrorMessage}`,
                  timestamp: event.timestamp,
                },
              ],
            };
          });
          clearTurnDuration(sessionId);
          return;
        }

        if (event.type === "session_idle") {
          delete draftRawBySessionRef.current[sessionId];
          delete draftSourceBySessionRef.current[sessionId];
          updateSession(sessionId, (current) => {
            const finalized = finalizeDraftAssistantMessage(
              current,
              event.timestamp,
              resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
            );
            return {
              ...finalized,
              ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
            };
          });
          clearTurnDuration(sessionId);
          return;
        }

        if (event.type === "session_finished") {
          delete draftRawBySessionRef.current[sessionId];
          delete draftSourceBySessionRef.current[sessionId];
          updateSession(sessionId, (current) => {
            const finalized = finalizeDraftAssistantMessage(
              current,
              event.timestamp,
              resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
            );
            return {
              ...finalized,
              status: "stopped",
            };
          });
          clearTurnDuration(sessionId);
        }
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [adapter, clearTurnDuration, refreshTaskData, resolveTurnDurationMs, updateSession],
  );

  const loadTaskDocuments = useCallback(async (repoPath: string, taskId: string) => {
    const [spec, plan, qa] = await Promise.all([
      host
        .specGet(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
      host
        .planGet(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
      host
        .qaGetReport(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
    ]);

    return {
      specMarkdown: spec,
      planMarkdown: plan,
      qaMarkdown: qa,
    };
  }, []);

  const loadRepoDefaultModel = useCallback(
    async (repoPath: string, role: AgentRole): Promise<AgentModelSelection | null> => {
      const config = await host.workspaceGetRepoConfig(repoPath);
      const roleDefault = config.agentDefaults[role];
      if (!roleDefault) {
        return null;
      }

      return {
        providerId: roleDefault.providerId,
        modelId: roleDefault.modelId,
        ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
        ...(roleDefault.opencodeAgent ? { opencodeAgent: roleDefault.opencodeAgent } : {}),
      };
    },
    [],
  );

  const ensureRuntime = useCallback(
    async (repoPath: string, taskId: string, role: AgentRole): Promise<RuntimeInfo> => {
      if (role === "build") {
        let run = runsRef.current.find(
          (entry) => entry.taskId === taskId && runningStates.has(entry.state),
        );
        if (!run) {
          run = await host.buildStart(repoPath, taskId);
          await refreshTaskData(repoPath);
        }
        return {
          runtimeId: null,
          runId: run.runId,
          baseUrl: toBaseUrl(run.port),
          workingDirectory: run.worktreePath,
        };
      }

      if (role === "qa") {
        const runtime = await host.opencodeRuntimeStart(repoPath, taskId, "qa");
        return {
          runtimeId: runtime.runtimeId,
          runId: null,
          baseUrl: toBaseUrl(runtime.port),
          workingDirectory: runtime.workingDirectory,
        };
      }

      const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
      return {
        runtimeId: runtime.runtimeId,
        runId: null,
        baseUrl: toBaseUrl(runtime.port),
        workingDirectory: runtime.workingDirectory,
      };
    },
    [refreshTaskData],
  );

  const ensureSessionReady = useCallback(
    async (sessionId: string): Promise<void> => {
      if (adapter.hasSession(sessionId)) {
        return;
      }
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const session = sessionsRef.current[sessionId];
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const task = taskRef.current.find((entry) => entry.id === session.taskId);
      if (!task) {
        throw new Error(`Task not found: ${session.taskId}`);
      }

      const docs = await loadTaskDocuments(activeRepo, session.taskId);
      const runtime =
        session.role === "spec" || session.role === "planner"
          ? await ensureRuntime(activeRepo, session.taskId, session.role)
          : {
              runtimeId: session.runtimeId,
              runId: session.runId,
              baseUrl: session.baseUrl,
              workingDirectory: session.workingDirectory,
            };
      const systemPrompt = buildAgentSystemPrompt({
        role: session.role,
        scenario: session.scenario,
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          specMarkdown: docs.specMarkdown,
          planMarkdown: docs.planMarkdown,
          latestQaReportMarkdown: docs.qaMarkdown,
        },
      });

      await adapter.resumeSession({
        sessionId: session.sessionId,
        externalSessionId: session.externalSessionId,
        repoPath: activeRepo,
        workingDirectory: runtime.workingDirectory,
        taskId: session.taskId,
        role: session.role,
        scenario: session.scenario,
        systemPrompt,
        baseUrl: runtime.baseUrl,
      });

      if (!unsubscribersRef.current.has(sessionId)) {
        attachSessionListener(activeRepo, sessionId);
      }

      updateSession(sessionId, (current) => ({
        ...current,
        status: "idle",
        runtimeId: runtime.runtimeId,
        runId: runtime.runId,
        baseUrl: runtime.baseUrl,
        workingDirectory: runtime.workingDirectory,
      }));

      const activeSession = sessionsRef.current[sessionId];
      if (activeSession) {
        void loadSessionTodos(
          sessionId,
          runtime.baseUrl,
          runtime.workingDirectory,
          activeSession.externalSessionId,
        );
      }
      if (activeSession && !activeSession.modelCatalog && !activeSession.isLoadingModelCatalog) {
        void loadSessionModelCatalog(sessionId, runtime.baseUrl, runtime.workingDirectory);
      }
    },
    [
      activeRepo,
      adapter,
      attachSessionListener,
      ensureRuntime,
      loadSessionModelCatalog,
      loadSessionTodos,
      loadTaskDocuments,
      updateSession,
    ],
  );

  const sendAgentMessage = useCallback(
    async (sessionId: string, content: string): Promise<void> => {
      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }

      await ensureSessionReady(sessionId);

      const selectedModel = sessionsRef.current[sessionId]?.selectedModel ?? undefined;
      turnStartedAtBySessionRef.current[sessionId] = Date.now();

      updateSession(sessionId, (current) => ({
        ...current,
        status: "running",
        draftAssistantText: "",
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: trimmed,
            timestamp: now(),
          },
        ],
      }));

      void adapter
        .sendUserMessage({
          sessionId,
          content: trimmed,
          ...(selectedModel ? { model: selectedModel } : {}),
        })
        .catch((error) => {
          updateSession(
            sessionId,
            (current) => ({
              ...current,
              status: "error",
              draftAssistantText: "",
              messages: [
                ...current.messages,
                {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Failed to send message: ${errorMessage(error)}`,
                  timestamp: now(),
                },
              ],
            }),
            { persist: false },
          );
          clearTurnDuration(sessionId);
        });
    },
    [adapter, clearTurnDuration, ensureSessionReady, updateSession],
  );

  const startAgentSession = useCallback(
    async ({
      taskId,
      role,
      scenario,
      sendKickoff = false,
    }: {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
      sendKickoff?: boolean;
    }): Promise<string> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const task = taskRef.current.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const docs = await loadTaskDocuments(activeRepo, taskId);
      const resolvedScenario = scenario ?? inferScenario(role, task, docs);
      const runtime = await ensureRuntime(activeRepo, taskId, role);
      const defaultModelSelection = await loadRepoDefaultModel(activeRepo, role).catch(() => null);
      const systemPrompt = buildAgentSystemPrompt({
        role,
        scenario: resolvedScenario,
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          specMarkdown: docs.specMarkdown,
          planMarkdown: docs.planMarkdown,
          latestQaReportMarkdown: docs.qaMarkdown,
        },
      });

      const summary = await adapter.startSession({
        repoPath: activeRepo,
        workingDirectory: runtime.workingDirectory,
        taskId,
        role,
        scenario: resolvedScenario,
        systemPrompt,
        baseUrl: runtime.baseUrl,
      });

      const initialSession: AgentSessionState = {
        sessionId: summary.sessionId,
        externalSessionId: summary.externalSessionId,
        taskId,
        role,
        scenario: resolvedScenario,
        status: "idle",
        startedAt: summary.startedAt,
        runtimeId: runtime.runtimeId,
        runId: runtime.runId,
        baseUrl: runtime.baseUrl,
        workingDirectory: runtime.workingDirectory,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Session started (${role} - ${resolvedScenario})`,
            timestamp: summary.startedAt,
          },
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `System prompt:\n\n${systemPrompt}`,
            timestamp: summary.startedAt,
          },
        ],
        draftAssistantText: "",
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: defaultModelSelection,
        isLoadingModelCatalog: true,
      };

      setSessionsById((current) => {
        const next = {
          ...current,
          [summary.sessionId]: initialSession,
        };
        sessionsRef.current = next;
        return next;
      });
      void persistSessionSnapshot(initialSession).catch(() => undefined);

      attachSessionListener(activeRepo, summary.sessionId);

      void loadSessionTodos(
        summary.sessionId,
        runtime.baseUrl,
        runtime.workingDirectory,
        summary.externalSessionId,
      );
      void loadSessionModelCatalog(summary.sessionId, runtime.baseUrl, runtime.workingDirectory);

      if (sendKickoff) {
        await sendAgentMessage(summary.sessionId, kickoffPrompt(role, resolvedScenario, task.id));
        await refreshTaskData(activeRepo);
      }

      return summary.sessionId;
    },
    [
      activeRepo,
      adapter,
      attachSessionListener,
      ensureRuntime,
      loadRepoDefaultModel,
      loadTaskDocuments,
      persistSessionSnapshot,
      refreshTaskData,
      sendAgentMessage,
      loadSessionModelCatalog,
      loadSessionTodos,
    ],
  );

  const stopAgentSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const session = sessionsRef.current[sessionId];
      if (!session) {
        return;
      }

      const unsubscribe = unsubscribersRef.current.get(sessionId);
      unsubscribe?.();
      unsubscribersRef.current.delete(sessionId);

      if (adapter.hasSession(sessionId)) {
        await adapter.stopSession(sessionId);
      }
      clearTurnDuration(sessionId);

      updateSession(sessionId, (current) => ({
        ...current,
        status: "stopped",
        draftAssistantText: "",
      }));
    },
    [adapter, clearTurnDuration, updateSession],
  );

  const updateAgentSessionModel = useCallback(
    (sessionId: string, selection: AgentModelSelection | null): void => {
      updateSession(sessionId, (current) => ({
        ...current,
        selectedModel: selection,
      }));
    },
    [updateSession],
  );

  const replyAgentPermission = useCallback(
    async (
      sessionId: string,
      requestId: string,
      reply: "once" | "always" | "reject",
      message?: string,
    ): Promise<void> => {
      await adapter.replyPermission({
        sessionId,
        requestId,
        reply,
        ...(message ? { message } : {}),
      });

      updateSession(sessionId, (current) => ({
        ...current,
        pendingPermissions: current.pendingPermissions.filter(
          (entry) => entry.requestId !== requestId,
        ),
      }));
    },
    [adapter, updateSession],
  );

  const answerAgentQuestion = useCallback(
    async (sessionId: string, requestId: string, answers: string[][]): Promise<void> => {
      await adapter.replyQuestion({ sessionId, requestId, answers });
      updateSession(sessionId, (current) => ({
        ...current,
        pendingQuestions: current.pendingQuestions.filter((entry) => entry.requestId !== requestId),
      }));
    },
    [adapter, updateSession],
  );

  useEffect(() => {
    return () => {
      const unsubs = [...unsubscribersRef.current.values()];
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      unsubscribersRef.current.clear();
    };
  }, []);

  const sessions = useMemo(
    () =>
      Object.values(sessionsById).sort((a, b) =>
        a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
      ),
    [sessionsById],
  );

  return {
    sessions,
    loadAgentSessions: async (taskId) => {
      try {
        await loadAgentSessions(taskId);
      } catch (error) {
        toast.error("Failed to load agent sessions", {
          description: errorMessage(error),
        });
      }
    },
    startAgentSession: async (input) => {
      try {
        return await startAgentSession(input);
      } catch (error) {
        toast.error("Failed to start agent session", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  };
}
