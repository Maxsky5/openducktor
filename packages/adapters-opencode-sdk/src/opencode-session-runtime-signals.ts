import {
  type AgentSessionTranscriptEventType,
  isAgentSessionTranscriptEventType,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import { readEventSessionId } from "./event-stream/shared";
import { readRecordProp } from "./guards";
import { extractMessageTotalTokens, readMessageModelSelection } from "./message-normalizers";
import type { ParsedOpencodeEvent as Event } from "./opencode-ingress";

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

export const isOpencodeSessionTranscriptEvent = (
  event: AgentEvent,
): event is OpencodeSessionTranscriptEvent => isAgentSessionTranscriptEventType(event.type);

export const readMessageUpdatedContextSignal = (
  event: Event,
): Extract<OpencodeSessionRuntimeSignal, { type: "context_updated" }> | null => {
  if (event.type !== "message.updated") {
    return null;
  }
  const properties = event.properties;
  const info = readRecordProp(properties, "info");
  const externalSessionId = readEventSessionId(event);
  if (!info || !externalSessionId) {
    return null;
  }
  const rawParts = Array.isArray(properties?.parts) ? properties.parts : [];
  const totalTokens = extractMessageTotalTokens(info, rawParts);
  if (!hasRuntimeType(totalTokens, "number")) {
    return null;
  }
  const model = readMessageModelSelection(info);
  return {
    type: "context_updated",
    externalSessionId,
    contextUsage: {
      totalTokens,
      ...(() => {
        if (model) {
          return { model };
        }
        return {};
      })(),
    },
  };
};

export const toOpencodeObservationFailureMessage = (error: Error): string => {
  const detail = error.message.trim();
  return detail.startsWith("OpenCode live event observation")
    ? detail
    : `OpenCode live event observation failed: ${detail || "unknown failure"}`;
};
