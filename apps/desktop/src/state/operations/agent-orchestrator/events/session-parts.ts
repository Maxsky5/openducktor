import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toSessionContextUsage } from "../support/assistant-meta";
import { sanitizeStreamingText, toAssistantMessageMeta, upsertMessage } from "../support/utils";
import type {
  DraftChannel,
  SessionEvent,
  SessionEventContext,
  SessionPart,
  SessionPartEvent,
} from "./session-event-types";
import {
  createPrePartTodoSettlement,
  scheduleDraftFlush,
  toPartStreamKey,
} from "./session-helpers";
import { handleToolPart } from "./session-tool-parts";

type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

const markSessionRunning = (context: SessionEventContext): void => {
  context.updateSession(
    context.sessionId,
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
  context: SessionEventContext,
  channel: DraftChannel,
  raw: string,
  messageId: string | undefined,
  source: "delta" | "part",
): void => {
  const currentRaw = context.draftRawBySessionRef.current[context.sessionId] ?? {};
  context.draftRawBySessionRef.current[context.sessionId] = {
    ...currentRaw,
    [channel]: raw,
  };

  const currentSource = context.draftSourceBySessionRef.current[context.sessionId] ?? {};
  context.draftSourceBySessionRef.current[context.sessionId] = {
    ...currentSource,
    [channel]: source,
  };

  if (context.draftMessageIdBySessionRef) {
    const currentMessageIds = context.draftMessageIdBySessionRef.current[context.sessionId] ?? {};
    context.draftMessageIdBySessionRef.current[context.sessionId] = {
      ...currentMessageIds,
      ...(messageId ? { [channel]: messageId } : {}),
    };
  }
};

const clearDraftChannelBuffer = (
  context: SessionEventContext,
  channel: DraftChannel,
  source?: "delta" | "part",
  messageId?: string,
): void => {
  const currentRaw = context.draftRawBySessionRef.current[context.sessionId] ?? {};
  const nextRaw = { ...currentRaw };
  delete nextRaw[channel];
  context.draftRawBySessionRef.current[context.sessionId] = nextRaw;

  const currentSource = context.draftSourceBySessionRef.current[context.sessionId] ?? {};
  context.draftSourceBySessionRef.current[context.sessionId] =
    source === undefined
      ? Object.fromEntries(Object.entries(currentSource).filter(([key]) => key !== channel))
      : {
          ...currentSource,
          [channel]: source,
        };

  if (context.draftMessageIdBySessionRef) {
    const currentMessageIds = context.draftMessageIdBySessionRef.current[context.sessionId] ?? {};
    context.draftMessageIdBySessionRef.current[context.sessionId] =
      messageId === undefined
        ? Object.fromEntries(Object.entries(currentMessageIds).filter(([key]) => key !== channel))
        : {
            ...currentMessageIds,
            [channel]: messageId,
          };
  }
};

const toReasoningMessageId = (messageId: string): string => `thinking:${messageId}`;

const resolvePartModelSelection = (
  context: SessionEventContext,
  current: AgentSessionState,
  messageId: string,
): AgentSessionState["selectedModel"] | null => {
  const existingMessage = current.messages.find((entry) => entry.id === messageId);
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

  const turnModel = context.turnModelBySessionRef?.current[context.sessionId];
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

  const existingMessage = current.messages.find((entry) => entry.id === messageId);
  const assistantMeta =
    existingMessage?.meta?.kind === "assistant"
      ? existingMessage.meta
      : {
          ...toAssistantMessageMeta(current, undefined, undefined, model),
          isFinal: false,
        };
  const nextAssistantMeta =
    existingMessage?.meta?.kind === "assistant"
      ? {
          ...assistantMeta,
          ...(assistantMeta.isFinal !== undefined ? { isFinal: assistantMeta.isFinal } : {}),
        }
      : assistantMeta;

  return {
    ...current,
    draftAssistantText: "",
    draftAssistantMessageId: null,
    messages: upsertMessage(current.messages, {
      id: messageId,
      role: "assistant",
      content: nextContent,
      timestamp: existingMessage?.timestamp ?? timestamp,
      meta: nextAssistantMeta,
    }),
  };
};

export const handleAssistantDelta = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  if (event.channel === "text") {
    if (!event.messageId || event.delta.length === 0) {
      return;
    }
    const messageId = event.messageId;
    markSessionRunning(context);
    clearDraftChannelBuffer(context, "text");
    context.updateSession(
      context.sessionId,
      (current) => {
        const existingMessage = current.messages.find((entry) => entry.id === messageId);
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

  if (context.draftSourceBySessionRef.current[context.sessionId]?.[event.channel] === "part") {
    return;
  }
  const nextRaw = `${
    context.draftRawBySessionRef.current[context.sessionId]?.[event.channel] ?? ""
  }${event.delta}`;
  updateDraftChannelBuffer(context, event.channel, nextRaw, event.messageId, "delta");
  markSessionRunning(context);
  scheduleDraftFlush(context);
};

const settleSessionBeforeDraftUpdate = (
  context: SessionEventContext,
  prepareCurrent: PrepareCurrent,
): void => {
  context.updateSession(
    context.sessionId,
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
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "text" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.synthetic) {
    return;
  }
  clearDraftChannelBuffer(context, "text");
  context.updateSession(
    context.sessionId,
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
  context: SessionEventContext,
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
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const messageId = toReasoningMessageId(part.messageId);
      const existingMessage = prepared.messages.find((entry) => entry.id === messageId);
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

const handleSubtaskPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "subtask" }>,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
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

const handleStepPart = (
  context: SessionEventContext,
  part: Extract<SessionPart, { kind: "step" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.phase !== "finish" || typeof part.totalTokens !== "number" || part.totalTokens <= 0) {
    return;
  }

  context.updateSession(
    context.sessionId,
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
  context: SessionEventContext,
  event: SessionPartEvent,
): void => {
  const part = event.part;
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
    case "subtask":
      handleSubtaskPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "step":
      handleStepPart(context, part, prepareCurrent);
      return;
  }
};
