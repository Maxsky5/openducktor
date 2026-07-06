import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import { asUnknownRecord, readArrayProp, readStringProp, type UnknownRecord } from "../../guards";
import type { readMessageModelSelection } from "../../message-normalizers";
import type { mapPartToAgentStreamPart } from "../../stream-part-mapper";
import type { SessionMessageMetadata } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { applyDeltaToPart } from "../shared";

export type MappedAssistantPart = NonNullable<ReturnType<typeof mapPartToAgentStreamPart>>;
export type MappedSubagentPart = Extract<MappedAssistantPart, { kind: "subagent" }>;

export const isAssistantMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  return (roleHint ?? runtime.messageRoleById.get(messageId)) === "assistant";
};

export const applyPendingDeltas = (
  runtime: EventStreamRuntime,
  partId: string,
  basePart: Part,
): Part => {
  const pendingDeltas = runtime.pendingDeltasByPartId.get(partId);
  if (!pendingDeltas || pendingDeltas.length === 0) {
    return basePart;
  }

  let nextPart = basePart;
  for (const pending of pendingDeltas) {
    const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
    if (updated) {
      nextPart = updated;
    }
  }
  runtime.pendingDeltasByPartId.delete(partId);
  return nextPart;
};

export const getKnownMessageParts = (runtime: EventStreamRuntime, messageId: string): Part[] => {
  const parts: Part[] = [];
  for (const part of runtime.partsById.values()) {
    if (part.messageID === messageId) {
      parts.push(part);
    }
  }
  return parts;
};

const isTerminalAssistantFinish = (value: string | undefined): boolean =>
  value === "stop" || value === "error";

export const hasTerminalStopSignalInParts = (
  parts: Part[],
  finish: string | undefined,
): boolean => {
  if (isTerminalAssistantFinish(finish)) {
    return true;
  }

  return parts.some(
    (part) =>
      part.type === "step-finish" &&
      typeof part.reason === "string" &&
      isTerminalAssistantFinish(part.reason),
  );
};

const hasTerminalStopSignalInRawParts = (parts: unknown[]): boolean => {
  return parts.some((part) => {
    const record = asUnknownRecord(part);
    return (
      record !== undefined &&
      readStringProp(record, ["type"]) === "step-finish" &&
      isTerminalAssistantFinish(readStringProp(record, ["reason"]))
    );
  });
};

export const hasMessageStopSignal = (input: {
  finish: string | undefined;
  rawParts: unknown[];
  parts: Part[];
}): boolean => {
  return (
    hasTerminalStopSignalInRawParts(input.rawParts) ||
    hasTerminalStopSignalInParts(input.parts, input.finish)
  );
};

export const isAssistantMessageSettled = (input: {
  messageCompletedAt: number | undefined;
  hasStopSignal: boolean;
}): boolean => {
  return input.messageCompletedAt !== undefined || input.hasStopSignal;
};

export const updateMessageMetadata = (
  runtime: EventStreamRuntime,
  messageId: string,
  updates: {
    timestamp?: string;
    model?: ReturnType<typeof readMessageModelSelection>;
    parentId?: string;
    text?: string;
    hasStopSignal?: boolean;
    totalTokens?: number;
    displayParts?: SessionMessageMetadata["displayParts"];
  },
): void => {
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session) {
    return;
  }

  const previous = session.messageMetadataById.get(messageId);
  const timestamp = updates.timestamp ?? previous?.timestamp ?? runtime.now();
  const model = updates.model ?? previous?.model;
  const parentId = updates.parentId ?? previous?.parentId;
  const text = updates.text ?? previous?.text;
  const hasStopSignal = updates.hasStopSignal ?? previous?.hasStopSignal;
  const totalTokens = updates.totalTokens ?? previous?.totalTokens;
  const displayParts = updates.displayParts ?? previous?.displayParts;

  session.messageMetadataById.set(messageId, {
    timestamp,
    ...(model ? { model } : {}),
    ...(parentId ? { parentId } : {}),
    ...(text ? { text } : {}),
    ...(hasStopSignal !== undefined ? { hasStopSignal } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(displayParts ? { displayParts } : {}),
  });
};

export const readRawMessageParts = (properties: unknown, info: unknown): unknown[] => {
  const directParts = readArrayProp(properties, "parts");
  if (directParts) {
    return directParts;
  }
  return readArrayProp(info, "parts") ?? [];
};

export const normalizeMessagePart = (
  rawPartRecord: UnknownRecord,
  messageId: string,
  externalSessionId: string,
): Part => {
  return {
    ...(rawPartRecord as Part),
    ...(readStringProp(rawPartRecord, ["sessionID", "sessionId", "session_id"])
      ? {}
      : { sessionID: externalSessionId }),
    ...(readStringProp(rawPartRecord, ["messageID", "messageId", "message_id"])
      ? {}
      : { messageID: messageId }),
  } as Part;
};

export type MessageEventHandler = (event: Event, runtime: EventStreamRuntime) => boolean;
