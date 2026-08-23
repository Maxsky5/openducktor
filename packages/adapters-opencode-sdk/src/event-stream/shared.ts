import { hasRuntimeType } from "@openducktor/contracts";
import type { Part, Session } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readStringProp, type UnknownRecord } from "../guards";
import {
  opencodePartPayloadSchema,
  opencodeSessionDetailPayloadSchema,
  type ParsedOpencodeEvent as Event,
} from "../opencode-ingress";
import {
  isAwaitingRuntimeTurnStart,
  markStreamTurnActive,
  markStreamTurnIdle,
} from "../session-activity";
import type { SessionInput, SessionRecord } from "../types";
import { readEventInfo, readEventProperties } from "./schemas";

export type PendingPartDelta = {
  field: string;
  delta: string;
};

export type PendingSubagentPartEmission = {
  part: Part;
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
  properties: UnknownRecord;
  info: Session;
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

export const setMessagePart = (state: MessagePartState, part: Part): void => {
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

export const deleteMessagePart = (state: MessagePartState, partId: string): Part | undefined => {
  const part = state.partsById.get(partId);
  if (!part) {
    return undefined;
  }
  state.partsById.delete(partId);
  removePartIdFromMessage(state, part.messageID, partId);
  return part;
};

export const getMessageParts = (state: MessagePartState, messageId: string): Part[] => {
  const partIds = state.partIdsByMessageId.get(messageId);
  if (!partIds) {
    return [];
  }
  const parts: Part[] = [];
  for (const partId of partIds) {
    const part = state.partsById.get(partId);
    if (part) {
      parts.push(part);
    }
  }
  return parts;
};

const PARENT_EXTERNAL_SESSION_ID_KEYS = ["parentID", "parentId", "parent_id"] as const;
const EVENT_SESSION_ID_KEYS = ["sessionID", "sessionId", "session_id", "session"] as const;
const NESTED_SESSION_ID_KEYS = ["sessionID", "sessionId", "session_id"] as const;

const readParentExternalSessionIdFromRecord = (
  source: UnknownRecord | undefined,
): string | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }

  for (const key of PARENT_EXTERNAL_SESSION_ID_KEYS) {
    const value = record[key];
    if (hasRuntimeType(value, "string") && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
};

export const readEventParentExternalSessionId = (
  properties: UnknownRecord | undefined,
): string | undefined => {
  return (
    readParentExternalSessionIdFromRecord(readRecordProp(properties, "info")) ??
    readParentExternalSessionIdFromRecord(properties)
  );
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

export const applyDeltaToPart = (part: Part, field: string, delta: string): Part | null => {
  const normalizedField = normalizePartDeltaField(field);
  const existing = Object.getOwnPropertyDescriptor(part, normalizedField)?.value;
  if (existing !== undefined && !hasRuntimeType(existing, "string")) {
    return null;
  }

  return opencodePartPayloadSchema.parse({
    ...part,
    [normalizedField]: `${hasRuntimeType(existing, "string") ? existing : ""}${delta}`,
  });
};

export const readEventSessionId = (event: Event): string | undefined => {
  const properties = event.properties;
  if (!properties) {
    return undefined;
  }

  const directSessionId = readStringProp(properties, EVENT_SESSION_ID_KEYS);
  if (directSessionId) {
    return directSessionId;
  }

  const part = readRecordProp(properties, "part");
  if (part) {
    const partSessionId = readStringProp(part, NESTED_SESSION_ID_KEYS);
    if (partSessionId) {
      return partSessionId;
    }
  }

  const info = readRecordProp(properties, "info");
  if (info) {
    const infoSessionId = readStringProp(info, NESTED_SESSION_ID_KEYS);
    if (infoSessionId) {
      return infoSessionId;
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      return readStringProp(info, ["id"]);
    }
  }

  return undefined;
};

export const readSessionLifecycleEvent = (event: Event): SessionLifecycleEvent | undefined => {
  if (
    event.type !== "session.created" &&
    event.type !== "session.updated" &&
    event.type !== "session.deleted"
  ) {
    return undefined;
  }

  const properties = event.properties;
  const parsedInfo = opencodeSessionDetailPayloadSchema.safeParse(readEventInfo(properties));
  if (!parsedInfo.success) {
    const issues = parsedInfo.error.issues
      .map((issue) => `info.${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid OpenCode ${event.type} info payload: ${issues}`);
  }
  const info = parsedInfo.data;
  if (info.parentID !== undefined && info.parentID.trim().length === 0) {
    throw new Error(
      `Invalid OpenCode ${event.type} info payload: info.parentID must be a non-empty session id`,
    );
  }
  return {
    type: event.type,
    properties,
    info,
    externalSessionId: info.id,
    parentExternalSessionId: info.parentID,
  };
};

export const readEventDirectory = (event: Event): string | undefined => {
  const properties = readEventProperties(event);
  if (!properties) {
    return undefined;
  }

  const directDirectory = readStringProp(properties, [
    "directory",
    "workingDirectory",
    "working_directory",
  ]);
  if (directDirectory) {
    return directDirectory;
  }

  const part = readRecordProp(properties, "part");
  if (part) {
    const partDirectory = readStringProp(part, [
      "directory",
      "workingDirectory",
      "working_directory",
    ]);
    if (partDirectory) {
      return partDirectory;
    }
  }

  const info = readRecordProp(properties, "info");
  if (info) {
    const infoDirectory = readStringProp(info, [
      "directory",
      "workingDirectory",
      "working_directory",
    ]);
    if (infoDirectory) {
      return infoDirectory;
    }
  }

  return undefined;
};

export const isRelevantEvent = (externalSessionId: string, event: Event): boolean => {
  return readEventSessionId(event) === externalSessionId;
};
