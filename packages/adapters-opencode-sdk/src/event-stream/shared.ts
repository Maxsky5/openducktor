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

export const isRelevantEvent = (externalSessionId: string, event: Event): boolean => {
  const properties = readEventProperties(event);
  if (!properties) {
    return false;
  }

  const directSessionId = readStringProp(properties, [
    "sessionID",
    "sessionId",
    "session_id",
    "session",
  ]);
  if (directSessionId) {
    return directSessionId === externalSessionId;
  }

  const part = readRecordProp(properties, "part");
  if (part) {
    const partSessionId = readStringProp(part, ["sessionID", "sessionId", "session_id"]);
    if (partSessionId) {
      return partSessionId === externalSessionId;
    }
  }

  const info = readRecordProp(properties, "info");
  if (info) {
    const infoSessionId = readStringProp(info, ["sessionID", "sessionId", "session_id"]);
    if (infoSessionId) {
      return infoSessionId === externalSessionId;
    }
  }

  return false;
};
