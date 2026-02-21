import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import type { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { MutableRefObject } from "react";
import {
  formatToolContent,
  isTodoToolName,
  settleDanglingTodoToolMessages,
} from "../../agent-tool-messages";
import { isMutatingPermission } from "../../permission-policy";
import {
  READ_ONLY_ROLES,
  finalizeDraftAssistantMessage,
  isDuplicateAssistantMessage,
  mergeTodoListPreservingOrder,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
  normalizeToolInput,
  normalizeToolText,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
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

export type SessionEventAdapter = Pick<OpencodeSdkAdapter, "subscribeEvents" | "replyPermission">;

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

export const attachAgentSessionListener = ({
  adapter,
  repoPath,
  sessionId,
  sessionsRef,
  draftRawBySessionRef,
  draftSourceBySessionRef,
  turnStartedAtBySessionRef,
  updateSession,
  resolveTurnDurationMs,
  clearTurnDuration,
  refreshTaskData,
  loadSessionTodos,
}: AttachAgentSessionListenerParams): (() => void) => {
  return adapter.subscribeEvents(sessionId, (event) => {
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
      const streamMessageKey =
        part.kind === "tool"
          ? `${part.messageId}:${part.callId || part.partId}`
          : `${part.messageId}:${part.partId}`;
      const shouldSettleTodoToolRows = part.kind !== "tool" || !isTodoToolName(part.tool);
      const applyPrePartTodoSettlement = (current: AgentSessionState): AgentSessionState => {
        if (!shouldSettleTodoToolRows) {
          return current;
        }
        const settledMessages = settleDanglingTodoToolMessages(current.messages, event.timestamp);
        if (settledMessages === current.messages) {
          return current;
        }
        return {
          ...current,
          messages: settledMessages,
        };
      };
      if (part.kind === "text") {
        if (!part.synthetic) {
          draftSourceBySessionRef.current[sessionId] = "part";
          draftRawBySessionRef.current[sessionId] = part.text;
          updateSession(
            sessionId,
            (current) => {
              const prepared = applyPrePartTodoSettlement(current);
              return {
                ...prepared,
                status: "running",
                draftAssistantText: sanitizeStreamingText(part.text),
              };
            },
            { persist: false },
          );
        }
        return;
      }

      if (part.kind === "reasoning") {
        updateSession(
          sessionId,
          (current) => {
            const prepared = applyPrePartTodoSettlement(current);
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
        return;
      }

      if (part.kind === "tool") {
        const input = normalizeToolInput(part.input);
        const output = normalizeToolText(part.output);
        const error = normalizeToolText(part.error);
        const isTodoTool = isTodoToolName(part.tool);
        const parsedEventTimestamp = Date.parse(event.timestamp);
        const observedEventTimestampMs = Number.isNaN(parsedEventTimestamp)
          ? Date.now()
          : parsedEventTimestamp;
        const todoUpdateFromTool = isTodoTool
          ? (parseTodosFromToolOutput(output) ?? parseTodosFromToolInput(input))
          : null;
        let shouldRefreshTaskData = false;
        let shouldRefreshSessionTodos = false;
        updateSession(
          sessionId,
          (current) => {
            const prepared = applyPrePartTodoSettlement(current);
            const fallbackMessageId = `tool:${streamMessageKey}`;
            const messageId = resolveToolMessageId(
              prepared.messages,
              {
                messageId: part.messageId,
                callId: part.callId,
                tool: part.tool,
                status: part.status,
              },
              fallbackMessageId,
            );
            const existing = prepared.messages.find((entry) => entry.id === messageId);
            const previousStatus =
              existing?.meta?.kind === "tool" ? existing.meta.status : undefined;
            const existingToolMeta = existing?.meta?.kind === "tool" ? existing.meta : null;
            const observedStartedAtMs =
              typeof existingToolMeta?.observedStartedAtMs === "number"
                ? existingToolMeta.observedStartedAtMs
                : observedEventTimestampMs;
            const observedEndedAtMs =
              part.status === "completed" || part.status === "error"
                ? observedEventTimestampMs
                : undefined;
            if (
              isOdtWorkflowMutationToolName(part.tool) &&
              part.status === "completed" &&
              previousStatus !== "completed"
            ) {
              shouldRefreshTaskData = true;
            }
            if (isTodoTool && part.status === "completed" && previousStatus !== "completed") {
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
                  ...(typeof observedStartedAtMs === "number" ? { observedStartedAtMs } : {}),
                  ...(typeof observedEndedAtMs === "number" ? { observedEndedAtMs } : {}),
                },
              }),
            };
          },
          { persist: false },
        );
        if (shouldRefreshTaskData) {
          void refreshTaskData(repoPath).catch(() => undefined);
        }
        if (shouldRefreshSessionTodos) {
          const session = sessionsRef.current[sessionId];
          if (session) {
            void loadSessionTodos(
              sessionId,
              session.baseUrl,
              session.workingDirectory,
              session.externalSessionId,
            ).catch(() => undefined);
          }
        }
        return;
      }

      if (part.kind === "subtask") {
        updateSession(
          sessionId,
          (current) => {
            const prepared = applyPrePartTodoSettlement(current);
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
      }
      return;
    }

    if (event.type === "assistant_message") {
      delete draftRawBySessionRef.current[sessionId];
      delete draftSourceBySessionRef.current[sessionId];
      updateSession(sessionId, (current) => {
        const settledMessages = settleDanglingTodoToolMessages(current.messages, event.timestamp);
        const messageAlreadyPresent = isDuplicateAssistantMessage(
          settledMessages,
          event.message,
          event.timestamp,
        );
        const durationMs = resolveTurnDurationMs(sessionId, event.timestamp, settledMessages);
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
      clearTurnDuration(sessionId);
      return;
    }

    if (event.type === "session_status") {
      const status = event.status;
      if (status.type === "busy") {
        if (turnStartedAtBySessionRef.current[sessionId] === undefined) {
          const busyStart = Date.parse(event.timestamp);
          turnStartedAtBySessionRef.current[sessionId] = Number.isNaN(busyStart)
            ? Date.now()
            : busyStart;
        }
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
      let shouldClear = false;
      updateSession(sessionId, (current) => {
        const finalized = finalizeDraftAssistantMessage(
          current,
          event.timestamp,
          resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
        );
        shouldClear =
          current.draftAssistantText.trim().length > 0 &&
          current.pendingPermissions.length === 0 &&
          current.pendingQuestions.length === 0;
        return {
          ...finalized,
          messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
          ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
        };
      });
      if (shouldClear) {
        clearTurnDuration(sessionId);
      }
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
            message: `Rejected by OpenDucktor ${role} read-only policy.`,
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
          todos: mergeTodoListPreservingOrder(current.todos, event.todos),
          messages: settleDanglingTodoToolMessages(current.messages, event.timestamp),
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
        const settledMessages = settleDanglingTodoToolMessages(
          finalized.messages,
          event.timestamp,
          {
            outcome: "error",
            errorMessage: sessionErrorMessage,
          },
        );
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
      clearTurnDuration(sessionId);
      return;
    }

    if (event.type === "session_idle") {
      delete draftRawBySessionRef.current[sessionId];
      delete draftSourceBySessionRef.current[sessionId];
      let shouldClear = false;
      updateSession(sessionId, (current) => {
        const finalized = finalizeDraftAssistantMessage(
          current,
          event.timestamp,
          resolveTurnDurationMs(sessionId, event.timestamp, current.messages),
        );
        shouldClear =
          current.draftAssistantText.trim().length > 0 &&
          current.pendingPermissions.length === 0 &&
          current.pendingQuestions.length === 0;
        return {
          ...finalized,
          messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
          ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
        };
      });
      if (shouldClear) {
        clearTurnDuration(sessionId);
      }
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
          messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
          pendingPermissions: [],
          pendingQuestions: [],
          status: "stopped",
        };
      });
      clearTurnDuration(sessionId);
    }
  });
};
