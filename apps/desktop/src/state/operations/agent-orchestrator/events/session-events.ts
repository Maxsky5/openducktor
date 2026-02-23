import { type AgentEnginePort, isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { MutableRefObject } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  formatToolContent,
  isTodoToolName,
  settleDanglingTodoToolMessages,
} from "../../agent-tool-messages";
import { isMutatingPermission } from "../../permission-policy";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import {
  finalizeDraftAssistantMessage,
  isDuplicateAssistantMessage,
  mergeTodoListPreservingOrder,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
  normalizeToolInput,
  normalizeToolText,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
  READ_ONLY_ROLES,
  resolveToolMessageId,
  sanitizeStreamingText,
  toAssistantMessageMeta,
  upsertMessage,
} from "../support/utils";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type ResolveTurnDuration = (
  sessionId: string,
  timestamp: string,
  messages?: AgentChatMessage[],
) => number | undefined;

export type SessionEventAdapter = Pick<AgentEnginePort, "subscribeEvents" | "replyPermission">;

type SessionEvent = Parameters<Parameters<SessionEventAdapter["subscribeEvents"]>[1]>[0];
type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
type SessionPart = SessionPartEvent["part"];

type AttachAgentSessionListenerParams = {
  adapter: SessionEventAdapter;
  repoPath: string;
  sessionId: string;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  draftRawBySessionRef: MutableRefObject<Record<string, string>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, "delta" | "part">>;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  updateSession: UpdateSession;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionId: string) => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  loadSessionTodos: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
};

type SessionEventContext = AttachAgentSessionListenerParams;

const MCP_TOOL_ERROR_PREFIX = /^\s*mcp\s+error\b/i;

const inferToolPartStatus = (
  part: Extract<SessionPart, { kind: "tool" }>,
  output: string | undefined,
): Extract<SessionPart, { kind: "tool" }>["status"] => {
  if (
    part.status === "completed" &&
    isOdtWorkflowMutationToolName(part.tool) &&
    typeof output === "string" &&
    MCP_TOOL_ERROR_PREFIX.test(output)
  ) {
    return "error";
  }
  return part.status;
};

const clearDraftBuffers = (context: SessionEventContext): void => {
  delete context.draftRawBySessionRef.current[context.sessionId];
  delete context.draftSourceBySessionRef.current[context.sessionId];
};

const eventTimestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const shouldClearTurnFromCurrentState = (current: AgentSessionState): boolean => {
  return (
    current.draftAssistantText.trim().length > 0 &&
    current.pendingPermissions.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

const settleDraftToIdle = (context: SessionEventContext, timestamp: string): boolean => {
  let shouldClear = false;
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      context.resolveTurnDurationMs(context.sessionId, timestamp, current.messages),
    );
    shouldClear = shouldClearTurnFromCurrentState(current);
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized.messages, timestamp),
      ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
    };
  });
  return shouldClear;
};

const toPartStreamKey = (part: SessionPart): string => {
  if (part.kind === "tool") {
    return `${part.messageId}:${part.callId || part.partId}`;
  }
  return `${part.messageId}:${part.partId}`;
};

const createPrePartTodoSettlement = (
  part: SessionPart,
  timestamp: string,
): ((current: AgentSessionState) => AgentSessionState) => {
  const shouldSettleTodoToolRows = part.kind !== "tool" || !isTodoToolName(part.tool);
  return (current: AgentSessionState): AgentSessionState => {
    if (!shouldSettleTodoToolRows) {
      return current;
    }
    const settledMessages = settleDanglingTodoToolMessages(current.messages, timestamp);
    if (settledMessages === current.messages) {
      return current;
    }
    return {
      ...current,
      messages: settledMessages,
    };
  };
};

const refreshTodosFromSessionRef = (context: SessionEventContext): void => {
  const session = context.sessionsRef.current[context.sessionId];
  if (!session) {
    return;
  }
  runOrchestratorSideEffect(
    "session-events-refresh-todos",
    context.loadSessionTodos(
      context.sessionId,
      session.baseUrl,
      session.workingDirectory,
      session.externalSessionId,
    ),
    {
      tags: {
        repoPath: context.repoPath,
        sessionId: context.sessionId,
        taskId: session.taskId,
        role: session.role,
        externalSessionId: session.externalSessionId,
      },
    },
  );
};

const handleSessionStarted = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_started" }>,
): void => {
  context.updateSession(context.sessionId, (current) => ({
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
};

const handleAssistantDelta = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  if (context.draftSourceBySessionRef.current[context.sessionId] === "part") {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "delta";
  const nextRaw = `${context.draftRawBySessionRef.current[context.sessionId] ?? ""}${event.delta}`;
  context.draftRawBySessionRef.current[context.sessionId] = nextRaw;
  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      status: "running",
      draftAssistantText: sanitizeStreamingText(nextRaw),
    }),
    { persist: false },
  );
};

const handleTextPart = (
  context: SessionEventContext,
  part: Extract<SessionPart, { kind: "text" }>,
  prepareCurrent: (current: AgentSessionState) => AgentSessionState,
): void => {
  if (part.synthetic) {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "part";
  context.draftRawBySessionRef.current[context.sessionId] = part.text;
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        draftAssistantText: sanitizeStreamingText(part.text),
      };
    },
    { persist: false },
  );
};

const handleReasoningPart = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_part" }>,
  part: Extract<SessionPart, { kind: "reasoning" }>,
  streamMessageKey: string,
  prepareCurrent: (current: AgentSessionState) => AgentSessionState,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const messageId = `thinking:${streamMessageKey}`;
      const existingMessage = prepared.messages.find((entry) => entry.id === messageId);
      const nextContent =
        part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
      if (nextContent.trim().length === 0) {
        return {
          ...prepared,
          status: "running",
        };
      }

      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
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
};

const handleToolPart = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_part" }>,
  part: Extract<SessionPart, { kind: "tool" }>,
  streamMessageKey: string,
  prepareCurrent: (current: AgentSessionState) => AgentSessionState,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedToolStatus = inferToolPartStatus(part, output);
  const isTodoTool = isTodoToolName(part.tool);
  const observedEventTimestampMs = eventTimestampMs(event.timestamp);
  const todoUpdateFromTool = isTodoTool
    ? (parseTodosFromToolOutput(output) ?? parseTodosFromToolInput(input))
    : null;
  let shouldRefreshTaskData = false;
  let shouldRefreshSessionTodos = false;

  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const fallbackMessageId = `tool:${streamMessageKey}`;
      const messageId = resolveToolMessageId(
        prepared.messages,
        {
          messageId: part.messageId,
          callId: part.callId,
          tool: part.tool,
          status: resolvedToolStatus,
        },
        fallbackMessageId,
      );
      const existing = prepared.messages.find((entry) => entry.id === messageId);
      const previousStatus = existing?.meta?.kind === "tool" ? existing.meta.status : undefined;
      const existingToolMeta = existing?.meta?.kind === "tool" ? existing.meta : null;
      const observedStartedAtMs =
        typeof existingToolMeta?.observedStartedAtMs === "number"
          ? existingToolMeta.observedStartedAtMs
          : observedEventTimestampMs;
      const observedEndedAtMs =
        resolvedToolStatus === "completed" || resolvedToolStatus === "error"
          ? observedEventTimestampMs
          : undefined;
      if (
        isOdtWorkflowMutationToolName(part.tool) &&
        resolvedToolStatus === "completed" &&
        previousStatus !== "completed"
      ) {
        shouldRefreshTaskData = true;
      }
      if (isTodoTool && resolvedToolStatus === "completed" && previousStatus !== "completed") {
        shouldRefreshSessionTodos = true;
      }

      return {
        ...prepared,
        status: "running",
        ...(todoUpdateFromTool
          ? { todos: mergeTodoListPreservingOrder(prepared.todos, todoUpdateFromTool) }
          : {}),
        messages: upsertMessage(prepared.messages, {
          id: messageId,
          role: "tool",
          content: formatToolContent({
            ...part,
            status: resolvedToolStatus,
            ...(typeof error === "string" && error.length > 0 ? { error } : {}),
            ...(typeof output === "string" && output.length > 0 ? { output } : {}),
          }),
          timestamp: event.timestamp,
          meta: {
            kind: "tool",
            partId: part.partId,
            callId: part.callId,
            tool: part.tool,
            status: resolvedToolStatus,
            ...(part.title ? { title: part.title } : {}),
            ...(input ? { input } : {}),
            ...(output ? { output } : {}),
            ...(error ? { error } : {}),
            ...(part.metadata ? { metadata: part.metadata } : {}),
            ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
            ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
            ...(typeof observedStartedAtMs === "number" ? { observedStartedAtMs } : {}),
            ...(typeof observedEndedAtMs === "number" ? { observedEndedAtMs } : {}),
          },
        }),
      };
    },
    { persist: false },
  );

  if (shouldRefreshTaskData) {
    runOrchestratorSideEffect(
      "session-events-refresh-task-data",
      context.refreshTaskData(context.repoPath),
      {
        tags: {
          repoPath: context.repoPath,
          sessionId: context.sessionId,
          tool: part.tool,
        },
      },
    );
  }
  if (shouldRefreshSessionTodos) {
    refreshTodosFromSessionRef(context);
  }
};

const handleSubtaskPart = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_part" }>,
  part: Extract<SessionPart, { kind: "subtask" }>,
  streamMessageKey: string,
  prepareCurrent: (current: AgentSessionState) => AgentSessionState,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
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
      };
    },
    { persist: false },
  );
};

const handleAssistantPart = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_part" }>,
): void => {
  const part = event.part;
  const streamMessageKey = toPartStreamKey(part);
  const prepareCurrent = createPrePartTodoSettlement(part, event.timestamp);

  switch (part.kind) {
    case "text":
      handleTextPart(context, part, prepareCurrent);
      return;
    case "reasoning":
      handleReasoningPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "tool":
      handleToolPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "subtask":
      handleSubtaskPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "step":
      return;
  }
};

const handleAssistantMessage = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_message" }>,
): void => {
  clearDraftBuffers(context);
  context.updateSession(context.sessionId, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current.messages, event.timestamp);
    const messageAlreadyPresent = isDuplicateAssistantMessage(
      settledMessages,
      event.message,
      event.timestamp,
    );
    const durationMs = context.resolveTurnDurationMs(
      context.sessionId,
      event.timestamp,
      settledMessages,
    );
    return {
      ...current,
      draftAssistantText: "",
      messages: messageAlreadyPresent
        ? settledMessages
        : [
            ...settledMessages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.message,
              timestamp: event.timestamp,
              meta: toAssistantMessageMeta(current, durationMs, event.totalTokens),
            },
          ],
    };
  });
  context.clearTurnDuration(context.sessionId);
};

const handleSessionStatus = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_status" }>,
): void => {
  const status = event.status;

  if (status.type === "busy") {
    if (context.turnStartedAtBySessionRef.current[context.sessionId] === undefined) {
      context.turnStartedAtBySessionRef.current[context.sessionId] = eventTimestampMs(
        event.timestamp,
      );
    }
    context.updateSession(
      context.sessionId,
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
    context.updateSession(
      context.sessionId,
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

  if (settleDraftToIdle(context, event.timestamp)) {
    context.clearTurnDuration(context.sessionId);
  }
};

const handlePermissionRequired = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "permission_required" }>,
): void => {
  const role = context.sessionsRef.current[context.sessionId]?.role;
  if (
    role &&
    READ_ONLY_ROLES.has(role) &&
    isMutatingPermission(event.permission, event.patterns, event.metadata)
  ) {
    const pendingPermission = {
      requestId: event.requestId,
      permission: event.permission,
      patterns: event.patterns,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
    void context.adapter
      .replyPermission({
        sessionId: context.sessionId,
        requestId: event.requestId,
        reply: "reject",
        message: `Rejected by OpenDucktor ${role} read-only policy.`,
      })
      .catch((error) => {
        context.updateSession(context.sessionId, (current) => ({
          ...current,
          pendingPermissions: [
            ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
            pendingPermission,
          ],
          messages: [
            ...current.messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Automatic permission rejection failed: ${errorMessage(error)}. Manual response required.`,
              timestamp: event.timestamp,
            },
          ],
        }));
      });

    context.updateSession(context.sessionId, (current) => ({
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

  context.updateSession(context.sessionId, (current) => ({
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
};

const handleQuestionRequired = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "question_required" }>,
): void => {
  context.updateSession(context.sessionId, (current) => ({
    ...current,
    pendingQuestions: [
      ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
      {
        requestId: event.requestId,
        questions: event.questions,
      },
    ],
  }));
};

const handleSessionTodosUpdated = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      todos: mergeTodoListPreservingOrder(current.todos, event.todos),
      messages: settleDanglingTodoToolMessages(current.messages, event.timestamp),
    }),
    { persist: false },
  );
};

const handleSessionError = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_error" }>,
): void => {
  clearDraftBuffers(context);
  const sessionErrorMessage = normalizeSessionErrorMessage(event.message);
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      event.timestamp,
      context.resolveTurnDurationMs(context.sessionId, event.timestamp, current.messages),
    );
    const settledMessages = settleDanglingTodoToolMessages(finalized.messages, event.timestamp, {
      outcome: "error",
      errorMessage: sessionErrorMessage,
    });
    return {
      ...finalized,
      status: "error",
      pendingPermissions: [],
      pendingQuestions: [],
      messages: [
        ...settledMessages,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Session error: ${sessionErrorMessage}`,
          timestamp: event.timestamp,
        },
      ],
    };
  });
  context.clearTurnDuration(context.sessionId);
};

const handleSessionIdle = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  clearDraftBuffers(context);
  if (settleDraftToIdle(context, event.timestamp)) {
    context.clearTurnDuration(context.sessionId);
  }
};

const handleSessionFinished = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_finished" }>,
): void => {
  clearDraftBuffers(context);
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      event.timestamp,
      context.resolveTurnDurationMs(context.sessionId, event.timestamp, current.messages),
    );
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
      pendingPermissions: [],
      pendingQuestions: [],
      status: "stopped",
    };
  });
  context.clearTurnDuration(context.sessionId);
};

const handleSessionEvent = (context: SessionEventContext, event: SessionEvent): void => {
  switch (event.type) {
    case "session_started":
      handleSessionStarted(context, event);
      return;
    case "assistant_delta":
      handleAssistantDelta(context, event);
      return;
    case "assistant_part":
      handleAssistantPart(context, event);
      return;
    case "assistant_message":
      handleAssistantMessage(context, event);
      return;
    case "session_status":
      handleSessionStatus(context, event);
      return;
    case "permission_required":
      handlePermissionRequired(context, event);
      return;
    case "question_required":
      handleQuestionRequired(context, event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context, event);
      return;
    case "session_error":
      handleSessionError(context, event);
      return;
    case "session_idle":
      handleSessionIdle(context, event);
      return;
    case "session_finished":
      handleSessionFinished(context, event);
      return;
    case "tool_call":
    case "tool_result":
      return;
  }
};

export const attachAgentSessionListener = (
  context: AttachAgentSessionListenerParams,
): (() => void) => {
  return context.adapter.subscribeEvents(context.sessionId, (event) => {
    handleSessionEvent(context, event);
  });
};
