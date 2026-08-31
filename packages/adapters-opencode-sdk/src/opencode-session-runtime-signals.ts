import {
  type AgentSessionTranscriptEventType,
  isAgentSessionTranscriptEventType,
} from "@openducktor/contracts";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import { readMessageModelSelection, toTokenTotal } from "./message-normalizers";
import type { ParsedOpencodeEvent as Event } from "./opencode-global-event-ingress";

export type OpencodeSessionContextUsage = {
  readonly totalTokens: number;
  readonly model?: AgentModelSelection;
};

export type OpencodeSessionTranscriptEvent = Extract<
  AgentEvent,
  { type: AgentSessionTranscriptEventType }
>;

export type OpencodeSessionRuntimeSignal =
  | {
      readonly type: "session_event";
      readonly externalSessionId: string;
      readonly event: AgentEvent;
    }
  | {
      readonly type: "context_updated";
      readonly externalSessionId: string;
      readonly contextUsage: OpencodeSessionContextUsage;
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
  const { info, sessionID: externalSessionId } = event.properties;
  if (info.role !== "assistant") {
    return null;
  }
  const totalTokens = toTokenTotal(info.tokens);
  if (totalTokens === undefined) {
    return null;
  }
  const model = readMessageModelSelection(info);
  const contextUsage: OpencodeSessionContextUsage = model
    ? { totalTokens, model }
    : { totalTokens };
  return {
    type: "context_updated",
    externalSessionId,
    contextUsage,
  };
};

export const toOpencodeObservationFailureMessage = (error: Error): string => {
  const detail = error.message.trim();
  return detail.startsWith("OpenCode live event observation")
    ? detail
    : `OpenCode live event observation failed: ${detail || "unknown failure"}`;
};
