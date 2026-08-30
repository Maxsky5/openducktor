import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import {
  opencodePartPayloadSchema,
  type ParsedOpencodePart,
  type ParsedOpencodeSession,
} from "../opencode-ingress";
import { type ParsedOpencodeEvent as Event } from "../opencode-global-event-ingress";
import {
  isAwaitingRuntimeTurnStart,
  markStreamTurnActive,
  markStreamTurnIdle,
} from "../session-activity";
import type { SessionInput, SessionRecord } from "../types";
import { z } from "zod";

export type PendingPartDelta = {
  field: string;
  delta: string;
};

export type PendingSubagentPartEmission = {
  part: ParsedOpencodePart;
  roleHint?: string;
};

export type PendingSubagentInputEvent = Extract<
  AgentEvent,
  { type: "approval_required" | "question_required" }
>;

export type PendingBackgroundTaskResult = {
  part: Extract<AgentStreamPart, { kind: "subagent" }>;
  timestamp: string;
};

export type PendingSubagentSessionBinding = {
  createdAtMs?: number;
  arrivalOrder: number;
};

type SessionLifecycleEvent = {
  type: "session.created" | "session.updated" | "session.deleted";
  info: ParsedOpencodeSession;
  externalSessionId: string;
  parentExternalSessionId: string | undefined;
};

export type EventStreamContext = {
  externalSessionId: string;
  input: SessionInput;
  now: () => string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
  session: SessionRecord;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

export type SubagentSessionLink = {
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey: string;
};

export type EventStreamRuntime = EventStreamContext;

type MessagePartState = Pick<SessionRecord, "partsById" | "partIdsByMessageId">;

const removePartIdFromMessage = (
  state: MessagePartState,
  messageId: string,
  partId: string,
): void => {
  const partIds = state.partIdsByMessageId.get(messageId);
  if (!partIds) {
    return;
  }
  partIds.delete(partId);
  if (partIds.size === 0) {
    state.partIdsByMessageId.delete(messageId);
  }
};

export const setMessagePart = (state: MessagePartState, part: ParsedOpencodePart): void => {
  const partId = part.id;
  const previous = state.partsById.get(partId);
  if (previous && previous.messageID !== part.messageID) {
    removePartIdFromMessage(state, previous.messageID, partId);
  }
  state.partsById.set(partId, part);
  const partIds = state.partIdsByMessageId.get(part.messageID) ?? new Set<string>();
  partIds.add(partId);
  state.partIdsByMessageId.set(part.messageID, partIds);
};

export const deleteMessagePart = (
  state: MessagePartState,
  partId: string,
): ParsedOpencodePart | undefined => {
  const part = state.partsById.get(partId);
  if (!part) {
    return undefined;
  }
  state.partsById.delete(partId);
  removePartIdFromMessage(state, part.messageID, partId);
  return part;
};

export const getMessageParts = (
  state: MessagePartState,
  messageId: string,
): ParsedOpencodePart[] => {
  const partIds = state.partIdsByMessageId.get(messageId);
  if (!partIds) {
    return [];
  }
  const parts: ParsedOpencodePart[] = [];
  for (const partId of partIds) {
    const part = state.partsById.get(partId);
    if (part) {
      parts.push(part);
    }
  }
  return parts;
};

export const readEventParentExternalSessionId = (event: Event): string | undefined => {
  if (
    event.type !== "session.created" &&
    event.type !== "session.updated" &&
    event.type !== "session.deleted"
  ) {
    return undefined;
  }
  return event.properties.info.parentID;
};

export const flushPendingSubagentInputEventsForSession = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
): void => {
  const subagentCorrelationKey =
    runtime.session.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
  if (!subagentCorrelationKey) {
    return;
  }

  const pending =
    runtime.session.pendingSubagentInputEventsByExternalSessionId.get(childExternalSessionId);
  if (!pending || pending.length === 0) {
    return;
  }

  runtime.session.pendingSubagentInputEventsByExternalSessionId.delete(childExternalSessionId);
  for (const event of pending) {
    runtime.emit(runtime.externalSessionId, {
      ...event,
      subagentCorrelationKey,
    });
  }
};

export const removePendingSubagentCorrelationKey = (
  state: Pick<
    SessionRecord,
    "pendingSubagentCorrelationKeys" | "pendingSubagentCorrelationKeysBySignature"
  >,
  correlationKey: string,
): void => {
  const pendingIndex = state.pendingSubagentCorrelationKeys.indexOf(correlationKey);
  if (pendingIndex >= 0) {
    state.pendingSubagentCorrelationKeys.splice(pendingIndex, 1);
  }

  for (const [signature, pending] of state.pendingSubagentCorrelationKeysBySignature) {
    if (!pending.includes(correlationKey)) {
      continue;
    }

    const nextPending = pending.filter((entry) => entry !== correlationKey);
    if (nextPending.length === 0) {
      state.pendingSubagentCorrelationKeysBySignature.delete(signature);
      continue;
    }

    state.pendingSubagentCorrelationKeysBySignature.set(signature, nextPending);
  }
};

export const bindSubagentPartCorrelation = (
  state: Pick<SessionRecord, "subagentCorrelationKeyByPartId" | "subagentPartIdByCorrelationKey">,
  partId: string,
  correlationKey: string,
): void => {
  state.subagentCorrelationKeyByPartId.set(partId, correlationKey);
  state.subagentPartIdByCorrelationKey.set(correlationKey, partId);
};

export const bindSubagentExternalSession = (
  state: Pick<
    SessionRecord,
    | "subagentCorrelationKeyByExternalSessionId"
    | "subagentPartIdByCorrelationKey"
    | "subagentPartIdByExternalSessionId"
  >,
  externalSessionId: string,
  correlationKey: string,
  partId?: string,
): void => {
  state.subagentCorrelationKeyByExternalSessionId.set(externalSessionId, correlationKey);
  if (!partId) {
    return;
  }
  state.subagentPartIdByCorrelationKey.set(correlationKey, partId);
  state.subagentPartIdByExternalSessionId.set(externalSessionId, partId);
};

export const markSessionActive = (context: Pick<EventStreamContext, "session">): void => {
  markStreamTurnActive(context.session);
};

export const markSessionIdle = (context: Pick<EventStreamContext, "session">): void => {
  markStreamTurnIdle(context.session);
};

export const isSessionAwaitingRuntimeTurnStart = (
  context: Pick<EventStreamContext, "session">,
): boolean => {
  return isAwaitingRuntimeTurnStart(context.session);
};

export const isReasoningDeltaField = (field: string): boolean => {
  return (
    field === "reasoning_content" ||
    field === "reasoning_details" ||
    field === "reasoningContent" ||
    field === "reasoningDetails"
  );
};

const normalizePartDeltaField = (field: string): string => {
  return isReasoningDeltaField(field) ? "text" : field;
};

export const applyDeltaToPart = (
  part: ParsedOpencodePart,
  field: string,
  delta: string,
): ParsedOpencodePart | null => {
  const normalizedField = normalizePartDeltaField(field);
  const existing = Object.getOwnPropertyDescriptor(part, normalizedField)?.value;
  const existingText = z.string().safeParse(existing);
  if (existing !== undefined && !existingText.success) {
    return null;
  }

  return opencodePartPayloadSchema.parse({
    ...part,
    [normalizedField]: `${existingText.success ? existingText.data : ""}${delta}`,
  });
};

export const readEventSessionId = (event: Event): string | undefined => {
  const properties = event.properties;
  if (!("sessionID" in properties)) {
    return undefined;
  }
  const sessionId = z.string().safeParse(properties.sessionID);
  return sessionId.success ? sessionId.data : undefined;
};

export const readSessionLifecycleEvent = (event: Event): SessionLifecycleEvent | undefined => {
  if (
    event.type !== "session.created" &&
    event.type !== "session.updated" &&
    event.type !== "session.deleted"
  ) {
    return undefined;
  }

  const info = event.properties.info;
  if (info.parentID !== undefined && info.parentID.trim().length === 0) {
    throw new Error(
      `Invalid OpenCode ${event.type} info payload: info.parentID must be a non-empty session id`,
    );
  }
  return {
    type: event.type,
    info,
    externalSessionId: info.id,
    parentExternalSessionId: info.parentID,
  };
};

export const readEventDirectory = (event: Event): string | undefined => {
  return event.properties.directory;
};

export const isRelevantEvent = (externalSessionId: string, event: Event): boolean => {
  return readEventSessionId(event) === externalSessionId;
};
