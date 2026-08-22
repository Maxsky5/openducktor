import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toAssistantMessageMeta } from "../support/assistant-meta";
import { toReasoningMessageId, toTextMessageId } from "../support/chat-message-ids";
import { sanitizeStreamingText } from "../support/core";
import {
  findSessionMessageById,
  replaceSessionMessageById,
  upsertSessionMessage,
} from "../support/messages";
import { type SubagentMeta, upsertSubagentMessage } from "../support/subagent-messages";
import type {
  SessionEvent,
  SessionPart,
  SessionPartEvent,
  SessionPartEventContext,
} from "./session-event-types";
import { createPrePartTodoSettlement, eventTimestampMs } from "./session-helpers";
import { handleToolPart } from "./session-tool-parts";

type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

const withRunningStatus = (session: AgentSessionState): AgentSessionState =>
  session.status === "running" && session.pendingUserMessageStartedAt === undefined
    ? session
    : { ...session, status: "running", pendingUserMessageStartedAt: undefined };

const markSessionRunning = (context: SessionPartEventContext): void => {
  context.store.updateSession(context.session.identity, (current) => withRunningStatus(current));
};

const isInactiveSessionStatus = (status: AgentSessionState["status"]): boolean => {
  return status === "idle" || status === "stopped" || status === "error";
};

const shouldRecordPartAsTurnActivity = (
  context: SessionPartEventContext,
  part: SessionPart,
): boolean => {
  if (part.kind !== "subagent") {
    return true;
  }

  const current = context.store.readSession(context.session.identity);
  // If the live session is unavailable, keep the existing activity path because inactivity cannot be proven.
  return current ? !isInactiveSessionStatus(current.status) : true;
};

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
      ...(existingMessage.meta.variant ? { variant: existingMessage.meta.variant } : undefined),
      ...(existingMessage.meta.profileId
        ? { profileId: existingMessage.meta.profileId }
        : undefined),
      ...(current.selectedModel?.runtimeKind
        ? { runtimeKind: current.selectedModel.runtimeKind }
        : undefined),
    };
  }

  const turnModel = context.turn.turnMetadata.readModel(context.session.key);
  return turnModel ?? current.selectedModel ?? null;
};

const upsertLiveAssistantMessage = ({
  current,
  model,
  messageId,
  partId,
  replacedMessageId,
  sourceMessageId,
  text,
  timestamp,
}: {
  current: AgentSessionState;
  model: AgentSessionState["selectedModel"] | null;
  messageId: string;
  partId?: string;
  replacedMessageId?: string;
  sourceMessageId?: string;
  text: string;
  timestamp: string;
}): AgentSessionState => {
  const nextContent = sanitizeStreamingText(text);
  if (nextContent.trim().length === 0) {
    return current;
  }

  const existingMessage = findSessionMessageById(current, replacedMessageId ?? messageId);
  const assistantMeta =
    existingMessage?.meta?.kind === "assistant"
      ? existingMessage.meta
      : {
          ...toAssistantMessageMeta(current, undefined, undefined, model),
          isFinal: false,
        };
  const nextMessage = {
    id: messageId,
    role: "assistant" as const,
    content: nextContent,
    timestamp: existingMessage?.timestamp ?? timestamp,
    meta: {
      ...assistantMeta,
      ...(partId ? { partId } : undefined),
      ...(sourceMessageId ? { sourceMessageId } : undefined),
    },
  };
  return {
    ...current,
    messages: replacedMessageId
      ? replaceSessionMessageById(current, replacedMessageId, nextMessage)
      : upsertSessionMessage(current, nextMessage),
  };
};

export const handleAssistantDelta = (
  context: SessionPartEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  context.turn.recordTurnActivityTimestamp(context.session.key, event.timestamp);
  if (event.channel === "text") {
    if (!event.messageId || event.delta.length === 0) {
      return;
    }
    const messageId = event.messageId;
    markSessionRunning(context);
    context.store.updateSession(context.session.identity, (current) => {
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
    });
    return;
  }

  if (event.delta.length > 0) {
    markSessionRunning(context);
  }
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
  context.store.updateSession(context.session.identity, (current) => {
    const prepared = prepareCurrent(current);
    if (part.text.trim().length === 0) {
      return withRunningStatus(prepared);
    }

    const sourceMessage = findSessionMessageById(prepared, part.messageId);
    const usesPartIdentity = prepared.runtimeKind === "claude";
    return upsertLiveAssistantMessage({
      current: {
        ...prepared,
        status: "running",
      },
      model: resolvePartModelSelection(context, prepared, part.messageId),
      messageId: usesPartIdentity ? toTextMessageId(part.messageId, part.partId) : part.messageId,
      ...(usesPartIdentity ? { partId: part.partId, sourceMessageId: part.messageId } : undefined),
      ...(usesPartIdentity && sourceMessage ? { replacedMessageId: part.messageId } : undefined),
      text: part.text,
      timestamp: event.timestamp,
    });
  });
};

const handleReasoningPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "reasoning" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  context.store.updateSession(context.session.identity, (current) => {
    const prepared = withRunningStatus(prepareCurrent(current));
    if (!part.completed) {
      return prepared;
    }

    const messageId = toReasoningMessageId(part.messageId, part.partId);
    const existingMessage = findSessionMessageById(prepared, messageId);
    const nextContent = part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
    if (nextContent.trim().length === 0) {
      return prepared;
    }

    return {
      ...prepared,
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
  });
};

const handleSubagentPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "subagent" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  const eventTimestamp = eventTimestampMs(event.timestamp);

  context.store.updateSession(context.session.identity, (current) => {
    const prepared = prepareCurrent(current);
    const incomingMeta: SubagentMeta = {
      kind: "subagent",
      partId: part.partId,
      correlationKey: part.correlationKey,
      sourceMessageId: part.messageId,
      status: part.status,
      ...(hasRuntimeType(part.agent, "string") ? { agent: part.agent } : undefined),
      ...(hasRuntimeType(part.prompt, "string") ? { prompt: part.prompt } : undefined),
      ...(hasRuntimeType(part.description, "string")
        ? { description: part.description }
        : undefined),
      ...(hasRuntimeType(part.error, "string") ? { error: part.error } : undefined),
      ...(hasRuntimeType(part.externalSessionId, "string")
        ? { externalSessionId: part.externalSessionId }
        : undefined),
      ...(part.executionMode ? { executionMode: part.executionMode } : undefined),
      ...(part.metadata ? { metadata: part.metadata } : undefined),
      ...(hasRuntimeType(part.startedAtMs, "number")
        ? { startedAtMs: part.startedAtMs }
        : undefined),
      ...(hasRuntimeType(part.endedAtMs, "number") ? { endedAtMs: part.endedAtMs } : undefined),
    };
    return {
      ...prepared,
      messages: upsertSubagentMessage({
        owner: prepared,
        incomingMeta,
        timestamp: event.timestamp,
        startedAtMsFallback: eventTimestamp,
      }),
    };
  });
};

export const handleAssistantPart = (
  context: SessionPartEventContext,
  event: SessionPartEvent,
): void => {
  const part = event.part;
  const recordsTurnActivity = part.kind !== "step" && shouldRecordPartAsTurnActivity(context, part);
  if (recordsTurnActivity) {
    const activityTimestamp =
      (part.kind === "tool" || part.kind === "subagent") &&
      hasRuntimeType(part.startedAtMs, "number")
        ? part.startedAtMs
        : event.timestamp;
    context.turn.recordTurnActivityTimestamp(context.session.key, activityTimestamp);
  }
  const preparePart = createPrePartTodoSettlement(part, event.timestamp);
  const prepareCurrent = recordsTurnActivity
    ? (current: AgentSessionState): AgentSessionState => ({
        ...preparePart(current),
        pendingUserMessageStartedAt: undefined,
      })
    : preparePart;

  switch (part.kind) {
    case "text":
      handleTextPart(context, event, part, prepareCurrent);
      return;
    case "reasoning":
      handleReasoningPart(context, event, part, prepareCurrent);
      return;
    case "tool":
      handleToolPart(context, event, part, prepareCurrent);
      return;
    case "subagent":
      handleSubagentPart(context, event, part, prepareCurrent);
      return;
    case "step":
      return;
  }
};
