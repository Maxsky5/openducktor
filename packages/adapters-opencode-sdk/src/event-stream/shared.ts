import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readStringProp } from "../guards";
import type { SessionInput, SessionRecord } from "../types";
import { readEventProperties } from "./schemas";

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
  { type: "permission_required" | "question_required" }
>;

export type PendingSubagentSessionBinding = {
  createdAtMs?: number;
  arrivalOrder: number;
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
  messageRoleById: Map<string, string>;
  pendingDeltasByPartId: Map<string, PendingPartDelta[]>;
  subagentCorrelationKeyByPartId: Map<string, string>;
  subagentCorrelationKeyByExternalSessionId: Map<string, string>;
  pendingSubagentCorrelationKeysBySignature: Map<string, string[]>;
  pendingSubagentCorrelationKeys: string[];
  pendingSubagentSessionsByExternalSessionId: Map<string, PendingSubagentSessionBinding>;
  pendingSubagentPartEmissionsByExternalSessionId: Map<string, PendingSubagentPartEmission[]>;
  pendingSubagentInputEventsByExternalSessionId: Map<string, PendingSubagentInputEvent[]>;
};

export type EventStreamRuntime = EventStreamContext & EventStreamState;

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
      timestamp: runtime.now(),
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

export const setSessionActive = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.hasIdleSinceActivity = false;
};

export const setSessionIdle = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.hasIdleSinceActivity = true;
  session.activeAssistantMessageId = null;
};

type SessionIdleEmitter = {
  externalSessionId: string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
  now: () => string;
};

export const emitIdleForSession = (
  session: SessionRecord | undefined,
  emitter: SessionIdleEmitter,
): boolean => {
  if (session?.hasIdleSinceActivity) {
    return false;
  }
  setSessionIdle(session);
  emitter.emit(emitter.externalSessionId, {
    type: "session_idle",
    externalSessionId: emitter.externalSessionId,
    timestamp: emitter.now(),
  });
  return true;
};

const getSessionRecord = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): SessionRecord | undefined => {
  return context.getSession(context.externalSessionId);
};

export const markSessionActive = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): void => {
  setSessionActive(getSessionRecord(context));
};

export const markSessionIdle = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession">,
): void => {
  setSessionIdle(getSessionRecord(context));
};

export const emitSessionIdle = (
  context: Pick<EventStreamContext, "externalSessionId" | "getSession" | "emit" | "now">,
): boolean => {
  return emitIdleForSession(getSessionRecord(context), context);
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

  const directSessionId = readStringProp(properties, [
    "sessionID",
    "sessionId",
    "session_id",
    "session",
  ]);
  if (directSessionId) {
    return directSessionId;
  }

  const part = readRecordProp(properties, "part");
  if (part) {
    const partSessionId = readStringProp(part, ["sessionID", "sessionId", "session_id"]);
    if (partSessionId) {
      return partSessionId;
    }
  }

  const info = readRecordProp(properties, "info");
  if (info) {
    const infoSessionId = readStringProp(info, ["sessionID", "sessionId", "session_id"]);
    if (infoSessionId) {
      return infoSessionId;
    }
  }

  return undefined;
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
