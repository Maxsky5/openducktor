import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { asUnknownRecord, readRecordProp, readStringProp } from "../guards";
import type { SessionInput, SessionRecord } from "../types";
import { readEventProperties } from "./schemas";

export type PendingPartDelta = {
  field: string;
  delta: string;
};

export type EventStreamContext = {
  sessionId: string;
  externalSessionId: string;
  input: SessionInput;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
};

export type EventStreamState = {
  partsById: Map<string, Part>;
  messageRoleById: Map<string, string>;
  pendingDeltasByPartId: Map<string, PendingPartDelta[]>;
};

export type EventStreamRuntime = EventStreamContext & EventStreamState;

export const setSessionActive = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.hasIdleSinceActivity = false;
};

type SessionIdleEmitter = {
  sessionId: string;
  emit: (sessionId: string, event: AgentEvent) => void;
  now: () => string;
};

export const emitIdleForSession = (
  session: SessionRecord | undefined,
  emitter: SessionIdleEmitter,
  messageId?: string,
): boolean => {
  if (messageId && session?.emittedIdleMessageIds.has(messageId)) {
    return false;
  }
  if (session?.hasIdleSinceActivity) {
    return false;
  }
  if (session) {
    session.hasIdleSinceActivity = true;
    if (messageId) {
      session.emittedIdleMessageIds.add(messageId);
    }
  }
  emitter.emit(emitter.sessionId, {
    type: "session_idle",
    sessionId: emitter.sessionId,
    timestamp: emitter.now(),
  });
  return true;
};

const getSessionRecord = (
  context: Pick<EventStreamContext, "sessionId" | "getSession">,
): SessionRecord | undefined => {
  return context.getSession(context.sessionId);
};

export const markSessionActive = (
  context: Pick<EventStreamContext, "sessionId" | "getSession">,
): void => {
  setSessionActive(getSessionRecord(context));
};

export const emitSessionIdle = (
  context: Pick<EventStreamContext, "sessionId" | "getSession" | "emit" | "now">,
  messageId?: string,
): boolean => {
  return emitIdleForSession(getSessionRecord(context), context, messageId);
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
