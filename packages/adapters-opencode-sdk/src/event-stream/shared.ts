import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readStringProp, type UnknownRecord } from "../guards";
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
  properties: UnknownRecord | undefined;
  info: UnknownRecord | undefined;
  externalSessionId: string | undefined;
  parentExternalSessionId: string | undefined;
};

export type EventStreamContext = {
  externalSessionId: string;
  input: SessionInput;
  now: () => string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
  getSession: (externalSessionId: string) => SessionRecord | undefined;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

export type SubagentSessionLink = {
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey: string;
};

export type EventStreamState = {
  partsById: Map<string, Part>;
  partIdsByMessageId: Map<string, Set<string>>;
  messageRoleById: Map<string, string>;
  compactionMessageIds: Set<string>;
  pendingDeltasByPartId: Map<string, PendingPartDelta[]>;
  subagentCorrelationKeyByPartId: Map<string, string>;
  subagentCorrelationKeyByExternalSessionId: Map<string, string>;
  subagentPartIdByCorrelationKey: Map<string, string>;
  subagentPartIdByExternalSessionId: Map<string, string>;
  pendingSubagentCorrelationKeysBySignature: Map<string, string[]>;
  pendingSubagentCorrelationKeys: string[];
  pendingSubagentSessionsByExternalSessionId: Map<string, PendingSubagentSessionBinding>;
  pendingSubagentPartEmissionsByExternalSessionId: Map<string, PendingSubagentPartEmission[]>;
  pendingSubagentInputEventsByExternalSessionId: Map<string, PendingSubagentInputEvent[]>;
  pendingBackgroundTaskResultsByExternalSessionId: Map<string, PendingBackgroundTaskResult[]>;
};

export type EventStreamRuntime = EventStreamContext & EventStreamState;

type MessagePartState = Pick<EventStreamState, "partsById" | "partIdsByMessageId">;

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

const readParentExternalSessionIdFromRecord = (source: unknown): string | undefined => {
  const record = asUnknownRecord(source);
  if (!record) {
    return undefined;
  }

  for (const key of PARENT_EXTERNAL_SESSION_ID_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
};

export const readEventParentExternalSessionId = (properties: unknown): string | undefined => {
  return (
    readParentExternalSessionIdFromRecord(readRecordProp(properties, "info")) ??
    readParentExternalSessionIdFromRecord(properties)
  );
};

const readLifecycleParentExternalSessionId = (info: unknown): string | undefined => {
  const parentExternalSessionId = readStringProp(info, ["parentID"]);
  if (parentExternalSessionId?.trim()) {
    return parentExternalSessionId;
  }
  if (typeof asUnknownRecord(info)?.parentID === "string") {
    throw new Error(
      "OpenCode session lifecycle event has malformed info.parentID lineage; expected a non-blank string.",
    );
  }
  return undefined;
};

export const flushPendingSubagentInputEventsForSession = (
  runtime: EventStreamRuntime,
  childExternalSessionId: string,
): void => {
  const subagentCorrelationKey =
    runtime.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
  if (!subagentCorrelationKey) {
    return;
  }

  const pending = runtime.pendingSubagentInputEventsByExternalSessionId.get(childExternalSessionId);
  if (!pending || pending.length === 0) {
    return;
  }

  runtime.pendingSubagentInputEventsByExternalSessionId.delete(childExternalSessionId);
  for (const event of pending) {
    runtime.emit(runtime.externalSessionId, {
      ...event,
      subagentCorrelationKey,
    });
  }
};

export const removePendingSubagentCorrelationKey = (
  state: Pick<
    EventStreamState,
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
  state: Pick<
    EventStreamState,
    "subagentCorrelationKeyByPartId" | "subagentPartIdByCorrelationKey"
  >,
  partId: string,
  correlationKey: string,
): void => {
  state.subagentCorrelationKeyByPartId.set(partId, correlationKey);
  state.subagentPartIdByCorrelationKey.set(correlationKey, partId);
};

export const bindSubagentExternalSession = (
  state: Pick<
    EventStreamState,
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

const getSessionRecord = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): SessionRecord | undefined => {
  return context.getSession(context.externalSessionId);
};

export const markSessionActive = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): void => {
  markStreamTurnActive(getSessionRecord(context));
};

export const markSessionIdle = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): void => {
  markStreamTurnIdle(getSessionRecord(context));
};

export const isSessionAwaitingRuntimeTurnStart = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): boolean => {
  return isAwaitingRuntimeTurnStart(getSessionRecord(context));
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
  const partRecord = asUnknownRecord(part);
  const existing = partRecord?.[normalizedField];
  if (existing !== undefined && typeof existing !== "string") {
    return null;
  }

  return {
    ...part,
    [normalizedField]: `${typeof existing === "string" ? existing : ""}${delta}`,
  } as Part;
};

export const readEventSessionId = (event: Event): string | undefined => {
  const properties = readEventProperties(event);
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
  const eventType = String(event.type);
  if (
    eventType !== "session.created" &&
    eventType !== "session.updated" &&
    eventType !== "session.deleted"
  ) {
    return undefined;
  }

  const properties = readEventProperties(event);
  const info = readEventInfo(properties);
  return {
    type: eventType,
    properties,
    info,
    externalSessionId: readEventSessionId(event),
    parentExternalSessionId: readLifecycleParentExternalSessionId(info),
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
