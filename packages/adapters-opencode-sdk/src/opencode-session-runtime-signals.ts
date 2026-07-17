import type { Event } from "@opencode-ai/sdk/v2/client";
import {
  type AgentSessionTranscriptEventType,
  isAgentSessionTranscriptEventType,
} from "@openducktor/contracts";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import { readEventSessionId } from "./event-stream/shared";
import { asUnknownRecord, readRecordProp } from "./guards";
import { extractMessageTotalTokens, readMessageModelSelection } from "./message-normalizers";

export type OpencodeSessionContextUsage = {
  readonly totalTokens: number;
  readonly model?: AgentModelSelection;
};

export type OpencodeSessionTranscriptEvent = Extract<
  AgentEvent,
  { type: AgentSessionTranscriptEventType }
>;

export type OpencodeSessionRuntimeSignal =
  | { readonly type: "sessions_invalidated" }
  | {
      readonly type: "context_updated";
      readonly externalSessionId: string;
      readonly contextUsage: OpencodeSessionContextUsage;
    }
  | {
      readonly type: "transcript_event";
      readonly externalSessionId: string;
      readonly event: OpencodeSessionTranscriptEvent;
    }
  | { readonly type: "fault"; readonly message: string };

const SESSION_INVALIDATION_EVENT_TYPES: ReadonlySet<string> = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "permission.asked",
  "permission.v2.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
]);

export const isOpencodeSessionTranscriptEvent = (
  event: AgentEvent,
): event is OpencodeSessionTranscriptEvent => isAgentSessionTranscriptEventType(event.type);

export const opencodeEventInvalidatesSessions = (event: Event): boolean =>
  SESSION_INVALIDATION_EVENT_TYPES.has(String(event.type));

export const readOpencodeSessionContextSignal = (
  event: Event,
): Extract<OpencodeSessionRuntimeSignal, { type: "context_updated" }> | null => {
  if (event.type !== "message.updated") {
    return null;
  }
  const properties = "properties" in event ? asUnknownRecord(event.properties) : null;
  const info = properties ? readRecordProp(properties, "info") : undefined;
  const externalSessionId = readEventSessionId(event);
  if (!info || !externalSessionId) {
    return null;
  }
  const rawParts = Array.isArray(properties?.parts) ? properties.parts : [];
  const totalTokens = extractMessageTotalTokens(info, rawParts);
  if (typeof totalTokens !== "number") {
    return null;
  }
  const model = readMessageModelSelection(info);
  return {
    type: "context_updated",
    externalSessionId,
    contextUsage: { totalTokens, ...(model ? { model } : {}) },
  };
};

export const toOpencodeObservationFailureMessage = (error: Error): string => {
  const detail = error.message.trim();
  return detail.startsWith("OpenCode live event observation")
    ? detail
    : `OpenCode live event observation failed: ${detail || "unknown failure"}`;
};
