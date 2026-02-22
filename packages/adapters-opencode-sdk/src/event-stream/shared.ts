import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import type { SessionInput, SessionRecord } from "../types";

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

export const readStringProp = (
  payload: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const normalizePartDeltaField = (field: string): string => {
  if (
    field === "reasoning_content" ||
    field === "reasoning_details" ||
    field === "reasoningContent" ||
    field === "reasoningDetails"
  ) {
    return "text";
  }
  return field;
};

export const applyDeltaToPart = (part: Part, field: string, delta: string): Part | null => {
  const normalizedField = normalizePartDeltaField(field);
  const partRecord = part as Record<string, unknown>;
  const existing = partRecord[normalizedField];
  if (existing !== undefined && typeof existing !== "string") {
    return null;
  }

  return {
    ...partRecord,
    [normalizedField]: `${typeof existing === "string" ? existing : ""}${delta}`,
  } as Part;
};

export const isRelevantEvent = (externalSessionId: string, event: Event): boolean => {
  const properties = event.properties as Record<string, unknown>;
  const directSessionId = readStringProp(properties, [
    "sessionID",
    "sessionId",
    "session_id",
    "session",
  ]);
  if (directSessionId) {
    return directSessionId === externalSessionId;
  }

  if ("part" in properties) {
    const part = properties.part as Record<string, unknown> | undefined;
    if (part && typeof part === "object") {
      const partSessionId = readStringProp(part, ["sessionID", "sessionId", "session_id"]);
      if (partSessionId) {
        return partSessionId === externalSessionId;
      }
    }
  }

  if ("info" in properties) {
    const info = properties.info as Record<string, unknown> | undefined;
    if (info && typeof info === "object") {
      const infoSessionId = readStringProp(info, ["sessionID", "sessionId", "session_id"]);
      if (infoSessionId) {
        return infoSessionId === externalSessionId;
      }
    }
  }

  return false;
};
