import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toAssistantMessageMeta, toSessionContextUsage } from "../support/assistant-meta";
import { sanitizeStreamingText } from "../support/core";
import {
  findLastSessionMessageByRole,
  findSessionMessageById,
  getSessionMessagesSlice,
  removeSessionMessageById,
  upsertSessionMessage,
} from "../support/messages";
import {
  formatSubagentContent,
  mergeSubagentMeta,
  type SubagentMeta,
} from "../support/subagent-messages";
import type {
  DraftChannel,
  SessionEvent,
  SessionPart,
  SessionPartEvent,
  SessionPartEventContext,
} from "./session-event-types";
import {
  createPrePartTodoSettlement,
  eventTimestampMs,
  scheduleDraftFlush,
  toPartStreamKey,
} from "./session-helpers";
import { handleToolPart } from "./session-tool-parts";

type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

const markSessionRunning = (context: SessionPartEventContext): void => {
  context.store.updateSession(
    context.store.sessionId,
    (current) =>
      current.status === "running"
        ? current
        : {
            ...current,
            status: "running",
          },
    { persist: false },
  );
};

const updateDraftChannelBuffer = (
  context: SessionPartEventContext,
  channel: DraftChannel,
  raw: string,
  messageId: string | undefined,
  source: "delta" | "part",
): void => {
  const currentRaw = context.drafts.draftRawBySessionRef.current[context.store.sessionId] ?? {};
  context.drafts.draftRawBySessionRef.current[context.store.sessionId] = {
    ...currentRaw,
    [channel]: raw,
  };

  const currentSource =
    context.drafts.draftSourceBySessionRef.current[context.store.sessionId] ?? {};
  context.drafts.draftSourceBySessionRef.current[context.store.sessionId] = {
    ...currentSource,
    [channel]: source,
  };

  if (context.drafts.draftMessageIdBySessionRef) {
    const currentMessageIds =
      context.drafts.draftMessageIdBySessionRef.current[context.store.sessionId] ?? {};
    context.drafts.draftMessageIdBySessionRef.current[context.store.sessionId] = {
      ...currentMessageIds,
      ...(messageId ? { [channel]: messageId } : {}),
    };
  }
};

const clearDraftChannelBuffer = (
  context: SessionPartEventContext,
  channel: DraftChannel,
  source?: "delta" | "part",
  messageId?: string,
): void => {
  if (channel === "reasoning") {
    const timeoutId =
      context.drafts.draftFlushTimeoutBySessionRef?.current[context.store.sessionId];
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      if (context.drafts.draftFlushTimeoutBySessionRef) {
        delete context.drafts.draftFlushTimeoutBySessionRef.current[context.store.sessionId];
      }
    }
  }

  const currentRaw = context.drafts.draftRawBySessionRef.current[context.store.sessionId] ?? {};
  const nextRaw = { ...currentRaw };
  delete nextRaw[channel];
  context.drafts.draftRawBySessionRef.current[context.store.sessionId] = nextRaw;

  const currentSource =
    context.drafts.draftSourceBySessionRef.current[context.store.sessionId] ?? {};
  context.drafts.draftSourceBySessionRef.current[context.store.sessionId] =
    source === undefined
      ? Object.fromEntries(Object.entries(currentSource).filter(([key]) => key !== channel))
      : {
          ...currentSource,
          [channel]: source,
        };

  if (context.drafts.draftMessageIdBySessionRef) {
    const currentMessageIds =
      context.drafts.draftMessageIdBySessionRef.current[context.store.sessionId] ?? {};
    context.drafts.draftMessageIdBySessionRef.current[context.store.sessionId] =
      messageId === undefined
        ? Object.fromEntries(Object.entries(currentMessageIds).filter(([key]) => key !== channel))
        : {
            ...currentMessageIds,
            [channel]: messageId,
          };
  }
};

const toReasoningMessageId = (messageId: string, partId: string): string =>
  `thinking:${messageId}:${partId}`;

const resolvePartModelSelection = (
  context: SessionPartEventContext,
  current: AgentSessionState,
  messageId: string,
): AgentSessionState["selectedModel"] | null => {
  const existingMessage = findSessionMessageById(current, messageId);
  if (existingMessage?.meta?.kind === "assistant") {
    if (!existingMessage.meta.providerId || !existingMessage.meta.modelId) {
      return null;
    }
    return {
      providerId: existingMessage.meta.providerId,
      modelId: existingMessage.meta.modelId,
      ...(existingMessage.meta.variant ? { variant: existingMessage.meta.variant } : {}),
      ...(existingMessage.meta.profileId ? { profileId: existingMessage.meta.profileId } : {}),
      ...(current.selectedModel?.runtimeKind
        ? { runtimeKind: current.selectedModel.runtimeKind }
        : {}),
    };
  }

  const turnModel = context.turn.turnModelBySessionRef?.current[context.store.sessionId];
  return turnModel ?? current.selectedModel ?? null;
};

const upsertLiveAssistantMessage = ({
  current,
  model,
  messageId,
  text,
  timestamp,
}: {
  current: AgentSessionState;
  model: AgentSessionState["selectedModel"] | null;
  messageId: string;
  text: string;
  timestamp: string;
}): AgentSessionState => {
  const nextContent = sanitizeStreamingText(text);
  if (nextContent.trim().length === 0) {
    return {
      ...current,
      draftAssistantText: "",
      draftAssistantMessageId: null,
    };
  }

  const existingMessage = findSessionMessageById(current, messageId);
  const assistantMeta =
    existingMessage?.meta?.kind === "assistant"
      ? existingMessage.meta
      : {
          ...toAssistantMessageMeta(current, undefined, undefined, model),
          isFinal: false,
        };

  return {
    ...current,
    draftAssistantText: "",
    draftAssistantMessageId: null,
    messages: upsertSessionMessage(current, {
      id: messageId,
      role: "assistant",
      content: nextContent,
      timestamp: existingMessage?.timestamp ?? timestamp,
      meta: assistantMeta,
    }),
  };
};

export const handleAssistantDelta = (
  context: SessionPartEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  context.turn.recordTurnActivityTimestamp?.(context.store.sessionId, event.timestamp);
  if (event.channel === "text") {
    if (!event.messageId || event.delta.length === 0) {
      return;
    }
    const messageId = event.messageId;
    markSessionRunning(context);
    clearDraftChannelBuffer(context, "text");
    context.store.updateSession(
      context.store.sessionId,
      (current) => {
        const existingMessage = findSessionMessageById(current, messageId);
        const baseContent = existingMessage?.role === "assistant" ? existingMessage.content : "";
        return upsertLiveAssistantMessage({
          current: {
            ...current,
            status: "running",
          },
          model: resolvePartModelSelection(context, current, messageId),
          messageId,
          text: `${baseContent}${event.delta}`,
          timestamp: event.timestamp,
        });
      },
      { persist: false },
    );
    return;
  }

  if (
    context.drafts.draftSourceBySessionRef.current[context.store.sessionId]?.[event.channel] ===
    "part"
  ) {
    return;
  }
  const nextRaw = `${
    context.drafts.draftRawBySessionRef.current[context.store.sessionId]?.[event.channel] ?? ""
  }${event.delta}`;
  updateDraftChannelBuffer(context, event.channel, nextRaw, event.messageId, "delta");
  markSessionRunning(context);
  scheduleDraftFlush(context);
};

const settleSessionBeforeDraftUpdate = (
  context: SessionPartEventContext,
  prepareCurrent: PrepareCurrent,
): void => {
  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return prepared.status === "running"
        ? prepared
        : {
            ...prepared,
            status: "running",
          };
    },
    { persist: false },
  );
};

const handleTextPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "text" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.synthetic) {
    return;
  }
  clearDraftChannelBuffer(context, "text");
  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      if (part.text.trim().length === 0) {
        return prepared.status === "running"
          ? prepared
          : {
              ...prepared,
              status: "running",
            };
      }

      return upsertLiveAssistantMessage({
        current: {
          ...prepared,
          status: "running",
        },
        model: resolvePartModelSelection(context, prepared, part.messageId),
        messageId: part.messageId,
        text: part.text,
        timestamp: event.timestamp,
      });
    },
    { persist: false },
  );
};

const handleReasoningPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "reasoning" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  settleSessionBeforeDraftUpdate(context, prepareCurrent);
  updateDraftChannelBuffer(context, "reasoning", part.text, part.messageId, "part");

  if (!part.completed) {
    scheduleDraftFlush(context);
    return;
  }

  clearDraftChannelBuffer(context, "reasoning");
  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const messageId = toReasoningMessageId(part.messageId, part.partId);
      const existingMessage = findSessionMessageById(prepared, messageId);
      const nextContent =
        part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
      if (nextContent.trim().length === 0) {
        return {
          ...prepared,
          status: "running",
          draftReasoningText: "",
          draftReasoningMessageId: null,
        };
      }

      return {
        ...prepared,
        status: "running",
        draftReasoningText: "",
        draftReasoningMessageId: null,
        messages: upsertSessionMessage(prepared, {
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

const handleSubagentPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "subagent" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  const eventTimestamp = eventTimestampMs(event.timestamp);

  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const fallbackMatches =
        typeof part.sessionId === "string" &&
        part.correlationKey.startsWith("session:") &&
        typeof part.agent === "string" &&
        typeof part.prompt === "string"
          ? getSessionMessagesSlice(prepared, 0).filter(
              (message) =>
                message.role === "system" &&
                message.meta?.kind === "subagent" &&
                !message.meta.sessionId &&
                message.meta.correlationKey.startsWith("part:") &&
                message.meta.agent === part.agent &&
                message.meta.prompt === part.prompt,
            )
          : [];
      const correlationMessage = findLastSessionMessageByRole(
        prepared,
        "system",
        (message) =>
          message.meta?.kind === "subagent" && message.meta.correlationKey === part.correlationKey,
      );
      const sessionMessage = part.sessionId
        ? findLastSessionMessageByRole(
            prepared,
            "system",
            (message) =>
              message.meta?.kind === "subagent" && message.meta.sessionId === part.sessionId,
          )
        : undefined;
      const fallbackMessage =
        correlationMessage || sessionMessage || fallbackMatches.length !== 1
          ? undefined
          : fallbackMatches[0];
      const existingMessage = correlationMessage ?? sessionMessage ?? fallbackMessage;
      const existingMeta = existingMessage?.meta?.kind === "subagent" ? existingMessage.meta : null;
      const incomingMeta: SubagentMeta = {
        kind: "subagent",
        partId: part.partId,
        correlationKey: part.correlationKey,
        status: part.status,
        ...(typeof part.agent === "string" ? { agent: part.agent } : {}),
        ...(typeof part.prompt === "string" ? { prompt: part.prompt } : {}),
        ...(typeof part.description === "string" ? { description: part.description } : {}),
        ...(typeof part.sessionId === "string" ? { sessionId: part.sessionId } : {}),
        ...(part.executionMode ? { executionMode: part.executionMode } : {}),
        ...(part.metadata ? { metadata: part.metadata } : {}),
        ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
        ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
      };
      const nextMeta = mergeSubagentMeta(existingMeta, incomingMeta, {
        startedAtMsFallback: eventTimestamp,
      });
      const duplicateMessageId =
        correlationMessage &&
        sessionMessage &&
        correlationMessage.id !== sessionMessage.id &&
        existingMessage?.id === correlationMessage.id
          ? sessionMessage.id
          : null;
      const nextPrepared =
        duplicateMessageId === null
          ? prepared
          : { ...prepared, messages: removeSessionMessageById(prepared, duplicateMessageId) };
      const nextMessageId = existingMessage?.id ?? `subagent:${part.correlationKey}`;

      return {
        ...nextPrepared,
        status: "running",
        messages: upsertSessionMessage(nextPrepared, {
          id: nextMessageId,
          role: "system",
          content: formatSubagentContent(nextMeta),
          timestamp: existingMessage?.timestamp ?? event.timestamp,
          meta: nextMeta,
        }),
      };
    },
    { persist: false },
  );
};

const handleStepPart = (
  context: SessionPartEventContext,
  part: Extract<SessionPart, { kind: "step" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.phase !== "finish" || typeof part.totalTokens !== "number" || part.totalTokens <= 0) {
    return;
  }

  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const model = resolvePartModelSelection(context, prepared, part.messageId);
      const nextContextUsage = toSessionContextUsage(prepared, part.totalTokens, model);
      if (!nextContextUsage) {
        return prepared.status === "running"
          ? prepared
          : {
              ...prepared,
              status: "running",
            };
      }

      if (context.turn.contextUsageMessageIdBySessionRef) {
        context.turn.contextUsageMessageIdBySessionRef.current[context.store.sessionId] =
          part.messageId;
      }

      return {
        ...prepared,
        status: "running",
        contextUsage: nextContextUsage,
      };
    },
    { persist: false },
  );
};

export const handleAssistantPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
): void => {
  const part = event.part;
  if (part.kind !== "step") {
    const activityTimestamp =
      (part.kind === "tool" || part.kind === "subagent") && typeof part.startedAtMs === "number"
        ? part.startedAtMs
        : event.timestamp;
    context.turn.recordTurnActivityTimestamp?.(context.store.sessionId, activityTimestamp);
  }
  const streamMessageKey = toPartStreamKey(part);
  const prepareCurrent = createPrePartTodoSettlement(part, event.timestamp);

  switch (part.kind) {
    case "text":
      handleTextPart(context, event, part, prepareCurrent);
      return;
    case "reasoning":
      handleReasoningPart(context, event, part, prepareCurrent);
      return;
    case "tool":
      handleToolPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "subagent":
      handleSubagentPart(context, event, part, prepareCurrent);
      return;
    case "step":
      handleStepPart(context, part, prepareCurrent);
      return;
  }
};
