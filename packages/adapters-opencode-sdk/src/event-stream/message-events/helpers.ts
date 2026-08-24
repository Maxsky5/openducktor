import type { Part } from "@opencode-ai/sdk/v2/client";
import type { readMessageModelSelection } from "../../message-normalizers";
import type { mapPartToAgentStreamPart } from "../../stream-part-mapper";
import type { SessionMessageMetadata } from "../../types";
import type { ParsedOpencodeEvent as Event } from "../../opencode-global-event-ingress";
import type { EventStreamRuntime } from "../shared";
import { applyDeltaToPart, getMessageParts } from "../shared";
import { removeMessageProjectionState } from "./message-state";

export const suppressCompactionMessage = (runtime: EventStreamRuntime, messageId: string): void => {
  removeMessageProjectionState(runtime, messageId);
  runtime.session.compactionMessageIds.add(messageId);
};

export type MappedAssistantPart = NonNullable<ReturnType<typeof mapPartToAgentStreamPart>>;
export type MappedSubagentPart = Extract<MappedAssistantPart, { kind: "subagent" }>;

export const isAssistantMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  return (roleHint ?? runtime.session.messageRoleById.get(messageId)) === "assistant";
};

export const applyPendingDeltas = (
  runtime: EventStreamRuntime,
  partId: string,
  basePart: Part,
): Part => {
  const pendingDeltas = runtime.session.pendingDeltasByPartId.get(partId);
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
  runtime.session.pendingDeltasByPartId.delete(partId);
  return nextPart;
};

export const getKnownMessageParts = (runtime: EventStreamRuntime, messageId: string): Part[] => {
  return getMessageParts(runtime.session, messageId);
};

const isTerminalAssistantFinish = (value: string | undefined): boolean =>
  value === "stop" || value === "error";

const isTerminalStepFinishReason = (value: string | undefined): boolean => value === "stop";

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
      isTerminalStepFinishReason(part.reason),
  );
};

export const hasMessageStopSignal = (input: {
  finish: string | undefined;
  parts: Part[];
}): boolean => {
  return hasTerminalStopSignalInParts(input.parts, input.finish);
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
  const { session } = runtime;

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
    ...(model ? { model } : undefined),
    ...(parentId ? { parentId } : undefined),
    ...(text ? { text } : undefined),
    ...(hasStopSignal !== undefined ? { hasStopSignal } : undefined),
    ...(totalTokens !== undefined ? { totalTokens } : undefined),
    ...(displayParts ? { displayParts } : undefined),
  });
};

export type MessageEventHandler = (event: Event, runtime: EventStreamRuntime) => boolean;
