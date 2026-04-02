import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentUserMessageState } from "@openducktor/core";
import {
  asUnknownRecord,
  readArrayProp,
  readRecordProp,
  readStringProp,
  readUnknownProp,
  type UnknownRecord,
} from "../guards";
import {
  ensureVisibleUserTextDisplayParts,
  extractMessageTotalTokens,
  mergePreservedAttachmentDisplayParts,
  normalizeUserMessageDisplayParts,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  readVisibleUserTextFromDisplayParts,
  sanitizeAssistantMessage,
} from "../message-normalizers";
import { toIsoFromEpoch } from "../session-runtime-utils";
import { mapPartToAgentStreamPart } from "../stream-part-mapper";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../types";
import {
  buildQueuedDisplayAttachmentIdentitySignature,
  buildQueuedDisplaySignature,
} from "../user-message-signatures";
import {
  readEventInfo,
  readEventPart,
  readEventProperties,
  readMessageCompletedAt,
} from "./schemas";
import type { EventStreamRuntime } from "./shared";
import {
  applyDeltaToPart,
  emitSessionIdle,
  isReasoningDeltaField,
  markSessionActive,
} from "./shared";

const isAssistantMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  return (roleHint ?? runtime.messageRoleById.get(messageId)) === "assistant";
};

const shouldSuppressAssistantStreamingAfterIdle = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  return Boolean(
    session?.hasIdleSinceActivity &&
      isAssistantMessage(runtime, messageId, roleHint) &&
      session.completedAssistantMessageIds.has(messageId),
  );
};

const emitAssistantPart = (
  runtime: EventStreamRuntime,
  part: Part,
  roleHint?: string,
  markActive = true,
): boolean => {
  const mapped = mapPartToAgentStreamPart(part);
  if (!mapped) {
    return false;
  }

  if (!isAssistantMessage(runtime, mapped.messageId, roleHint)) {
    return false;
  }

  if (shouldSuppressAssistantStreamingAfterIdle(runtime, mapped.messageId, roleHint)) {
    return false;
  }

  if (markActive) {
    markSessionActive(runtime);
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_part",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    part: mapped,
  });
  return true;
};

const emitKnownAssistantPartsForMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
  markActive = true,
): void => {
  if (shouldSuppressAssistantStreamingAfterIdle(runtime, messageId, roleHint)) {
    return;
  }

  for (const part of runtime.partsById.values()) {
    if (part.messageID !== messageId) {
      continue;
    }
    emitAssistantPart(runtime, part, roleHint, markActive);
  }
};

const applyPendingDeltas = (runtime: EventStreamRuntime, partId: string, basePart: Part): Part => {
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

const getKnownMessageParts = (runtime: EventStreamRuntime, messageId: string): Part[] => {
  return [...runtime.partsById.values()].filter((part) => part.messageID === messageId);
};

const hasTerminalStopSignalInParts = (parts: Part[], finish: string | undefined): boolean => {
  if (finish === "stop") {
    return true;
  }

  return parts.some(
    (part) =>
      part.type === "step-finish" && typeof part.reason === "string" && part.reason === "stop",
  );
};

const hasTerminalStopSignalInRawParts = (parts: unknown[]): boolean => {
  return parts.some((part) => {
    const record = asUnknownRecord(part);
    return (
      record !== undefined &&
      readStringProp(record, ["type"]) === "step-finish" &&
      readStringProp(record, ["reason"]) === "stop"
    );
  });
};

const hasMessageStopSignal = (input: {
  finish: string | undefined;
  rawParts: unknown[];
  parts: Part[];
}): boolean => {
  return (
    hasTerminalStopSignalInRawParts(input.rawParts) ||
    hasTerminalStopSignalInParts(input.parts, input.finish)
  );
};

const isAssistantMessageSettled = (input: {
  messageCompletedAt: number | undefined;
  hasStopSignal: boolean;
}): boolean => {
  return input.messageCompletedAt !== undefined || input.hasStopSignal;
};

const updateAssistantMessageCompletionState = (
  runtime: EventStreamRuntime,
  messageId: string,
  isCompleted: boolean,
): void => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session) {
    return;
  }

  if (!isCompleted && session.completedAssistantMessageIds.has(messageId)) {
    return;
  }

  const previousActiveAssistantMessageId = session.activeAssistantMessageId;
  if (isCompleted) {
    if (session.activeAssistantMessageId === messageId) {
      session.activeAssistantMessageId = null;
    }
    session.completedAssistantMessageIds.add(messageId);
  } else {
    session.activeAssistantMessageId = messageId;
  }

  if (previousActiveAssistantMessageId !== session.activeAssistantMessageId) {
    reconcileUserMessageQueuedStates(runtime);
  }
};

const updateMessageMetadata = (
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
  const session = runtime.getSession(runtime.sessionId);
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

type UserDisplayPart = import("@openducktor/core").AgentUserMessageDisplayPart;
type AttachmentDisplayPart = Extract<UserDisplayPart, { kind: "attachment" }>;

const readPreservedAttachmentParts = (input: {
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): AttachmentDisplayPart[] => {
  return [
    ...(input.metadata?.displayParts?.filter(
      (part): part is AttachmentDisplayPart => part.kind === "attachment",
    ) ?? []),
    ...(input.matchedQueuedSend?.attachmentParts ?? []),
  ];
};

const buildVisibleUserMessage = (input: {
  fallbackText: string;
  normalizedDisplayParts: UserDisplayPart[];
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): {
  displayParts: UserDisplayPart[];
  visible: string;
} => {
  const mergedDisplayParts = mergePreservedAttachmentDisplayParts(
    input.normalizedDisplayParts,
    readPreservedAttachmentParts({
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.matchedQueuedSend ? { matchedQueuedSend: input.matchedQueuedSend } : {}),
    }),
  );
  const displayParts = ensureVisibleUserTextDisplayParts(
    mergedDisplayParts.length > 0 ? mergedDisplayParts : (input.metadata?.displayParts ?? []),
    input.fallbackText,
  );
  const textFromParts = readVisibleUserTextFromDisplayParts(displayParts);
  return {
    displayParts,
    visible: textFromParts.length > 0 ? textFromParts : input.fallbackText,
  };
};

const persistUserMessageMetadata = (input: {
  session: ReturnType<EventStreamRuntime["getSession"]>;
  messageId: string;
  timestamp: string;
  metadata?: SessionMessageMetadata;
  model?: ReturnType<typeof readMessageModelSelection>;
  visible: string;
  displayParts: UserDisplayPart[];
}): void => {
  input.session?.messageMetadataById.set(input.messageId, {
    timestamp: input.metadata?.timestamp ?? input.timestamp,
    ...(input.model
      ? { model: input.model }
      : input.metadata?.model
        ? { model: input.metadata.model }
        : {}),
    ...(input.metadata?.parentId ? { parentId: input.metadata.parentId } : {}),
    text: input.visible,
    ...(input.displayParts.length > 0 ? { displayParts: input.displayParts } : {}),
  });
};

const maybeEmitCompletedAssistantMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp?: string;
    info?: unknown;
    hasStopSignal?: boolean;
  },
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session || !isAssistantMessage(runtime, input.messageId)) {
    return false;
  }

  const assistantParts = getKnownMessageParts(runtime, input.messageId);
  const existingMetadata = session.messageMetadataById.get(input.messageId);
  const totalTokens =
    input.info !== undefined
      ? (extractMessageTotalTokens(input.info, assistantParts) ?? existingMetadata?.totalTokens)
      : existingMetadata?.totalTokens;
  const assistantModel =
    input.info !== undefined
      ? (readMessageModelSelection(input.info) ?? existingMetadata?.model)
      : existingMetadata?.model;
  const hasStopSignal =
    input.hasStopSignal === true ||
    existingMetadata?.hasStopSignal === true ||
    hasTerminalStopSignalInParts(assistantParts, undefined);
  const timestamp = input.timestamp ?? existingMetadata?.timestamp ?? runtime.now();

  updateMessageMetadata(runtime, input.messageId, {
    timestamp,
    ...(assistantModel ? { model: assistantModel } : {}),
    hasStopSignal,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  });

  if (!hasStopSignal || assistantParts.length === 0) {
    return false;
  }

  const text = readTextFromParts(assistantParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    emitSessionIdle(runtime);
    reconcileUserMessageQueuedStates(runtime);
    return true;
  }

  if (session.emittedAssistantMessageIds.has(input.messageId)) {
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_message",
    sessionId: runtime.sessionId,
    timestamp,
    messageId: input.messageId,
    message: visible,
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
    ...(assistantModel ? { model: assistantModel } : {}),
  });
  session.emittedAssistantMessageIds.add(input.messageId);

  emitSessionIdle(runtime);
  reconcileUserMessageQueuedStates(runtime);
  return true;
};

const emitKnownUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  const metadata = session?.messageMetadataById.get(input.messageId);
  const knownDisplayParts = normalizeUserMessageDisplayParts(
    getKnownMessageParts(runtime, input.messageId),
  );
  const fallbackText = metadata?.text ?? "";
  const displayParts = ensureVisibleUserTextDisplayParts(
    knownDisplayParts.length > 0 ? knownDisplayParts : (metadata?.displayParts ?? []),
    fallbackText,
  );
  const textFromParts = readVisibleUserTextFromDisplayParts(displayParts);
  const visible = textFromParts.length > 0 ? textFromParts : fallbackText;
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return false;
  }

  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp: input.timestamp,
    message: visible,
    parts: displayParts,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
};

const buildUserMessageSignature = (input: {
  timestamp: string;
  message: string;
  parts: import("@openducktor/core").AgentUserMessageDisplayPart[];
  state: AgentUserMessageState;
  model?: ReturnType<typeof readMessageModelSelection>;
}): string => {
  const model = input.model;
  return JSON.stringify({
    timestamp: input.timestamp,
    message: input.message,
    parts: input.parts,
    state: input.state,
    providerId: model?.providerId ?? null,
    modelId: model?.modelId ?? null,
    variant: model?.variant ?? null,
    profileId: model?.profileId ?? null,
  });
};

const emitUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    message: string;
    parts: import("@openducktor/core").AgentUserMessageDisplayPart[];
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  const signature = buildUserMessageSignature(input);
  if (session?.emittedUserMessageSignatures.get(input.messageId) === signature) {
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "user_message",
    sessionId: runtime.sessionId,
    timestamp: input.timestamp,
    messageId: input.messageId,
    message: input.message,
    parts: input.parts,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
  session?.emittedUserMessageSignatures.set(input.messageId, signature);
  session?.emittedUserMessageStates.set(input.messageId, input.state);
  return true;
};

const readExplicitUserMessageState = (
  ...sources: Array<unknown>
): AgentUserMessageState | undefined => {
  for (const source of sources) {
    const rawState = readStringProp(source, ["state"]);
    if (rawState === "queued" || rawState === "read") {
      return rawState;
    }
  }
  return undefined;
};

const takeQueuedUserSendMatch = (
  runtime: EventStreamRuntime,
  visible: string,
  parts: import("@openducktor/core").AgentUserMessageDisplayPart[],
  model: ReturnType<typeof readMessageModelSelection> | undefined,
): import("../types").QueuedUserMessageSend | null => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session || session.pendingQueuedUserMessages.length === 0) {
    return null;
  }

  const signature = buildQueuedDisplaySignature({
    visible,
    parts,
    ...(model ? { model } : {}),
  });
  const attachmentIdentitySignature = buildQueuedDisplayAttachmentIdentitySignature({
    visible,
    parts,
    ...(model ? { model } : {}),
  });
  const matchIndex = session.pendingQueuedUserMessages.findIndex(
    (entry) =>
      entry.signature === signature ||
      entry.attachmentIdentitySignature === attachmentIdentitySignature,
  );
  if (matchIndex < 0) {
    return null;
  }

  return session.pendingQueuedUserMessages.splice(matchIndex, 1)[0] ?? null;
};

const resolveUserMessageStateFromPendingAssistant = (
  session: ReturnType<EventStreamRuntime["getSession"]>,
  messageId: string,
): AgentUserMessageState => {
  const activeAssistantMessageId = session?.activeAssistantMessageId;
  if (!session || !activeAssistantMessageId) {
    return "read";
  }

  return messageId > activeAssistantMessageId ? "queued" : "read";
};

const resolveLiveUserMessageState = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible: string;
    parts: import("@openducktor/core").AgentUserMessageDisplayPart[];
    explicitState?: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
    matchedQueuedSend?: import("../types").QueuedUserMessageSend | null;
  },
): AgentUserMessageState => {
  const session = runtime.getSession(runtime.sessionId);
  const pendingAssistantState = resolveUserMessageStateFromPendingAssistant(
    session,
    input.messageId,
  );
  const matchedQueuedSend = input.matchedQueuedSend;

  if (matchedQueuedSend && pendingAssistantState === "queued") {
    return "queued";
  }

  if (input.explicitState) {
    return input.explicitState;
  }

  return pendingAssistantState;
};

export const reconcileUserMessageQueuedStates = (runtime: EventStreamRuntime): void => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session) {
    return;
  }

  for (const [messageId, emittedState] of session.emittedUserMessageStates.entries()) {
    if (runtime.messageRoleById.get(messageId) !== "user") {
      continue;
    }

    const nextState = resolveUserMessageStateFromPendingAssistant(session, messageId);
    if (nextState === emittedState) {
      continue;
    }

    const metadata = session.messageMetadataById.get(messageId);
    emitKnownUserMessage(runtime, {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: nextState,
      ...(metadata?.model ? { model: metadata.model } : {}),
    });
  }
};

const readRawMessageParts = (properties: unknown, info: unknown): unknown[] => {
  const directParts = readArrayProp(properties, "parts");
  if (directParts) {
    return directParts;
  }
  return readArrayProp(info, "parts") ?? [];
};

const normalizeMessagePart = (
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

const handleMessageUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  if (!properties) {
    return true;
  }
  const infoRecord = readEventInfo(properties);

  const messageId = infoRecord
    ? readStringProp(infoRecord, ["id", "messageID", "messageId", "message_id"])
    : undefined;
  const role = infoRecord ? readStringProp(infoRecord, ["role"]) : undefined;
  const messageTimestamp = (() => {
    const infoTime = infoRecord ? readRecordProp(infoRecord, "time") : undefined;
    return toIsoFromEpoch(infoTime?.created, runtime.now);
  })();
  const messageCompletedAt = infoRecord ? readMessageCompletedAt(infoRecord) : undefined;
  const messageModel = readMessageModelSelection(infoRecord);
  const session = runtime.getSession(runtime.sessionId);
  const previousRole = messageId ? runtime.messageRoleById.get(messageId) : undefined;
  const finish = infoRecord ? readStringProp(infoRecord, ["finish"]) : undefined;
  const rawParts = readRawMessageParts(properties, infoRecord);
  const parentId = infoRecord
    ? readStringProp(infoRecord, ["parentID", "parentId", "parent_id"])
    : undefined;
  const existingMetadata = messageId ? session?.messageMetadataById.get(messageId) : undefined;
  if (messageId && role) {
    runtime.messageRoleById.set(messageId, role);
    updateMessageMetadata(runtime, messageId, {
      timestamp: messageTimestamp,
      ...(messageModel
        ? { model: messageModel }
        : existingMetadata?.model
          ? { model: existingMetadata.model }
          : {}),
      ...(parentId
        ? { parentId }
        : existingMetadata?.parentId
          ? { parentId: existingMetadata.parentId }
          : {}),
      ...(existingMetadata?.text ? { text: existingMetadata.text } : {}),
      ...(existingMetadata?.displayParts ? { displayParts: existingMetadata.displayParts } : {}),
    });
  }

  const isAssistantRole = messageId ? isAssistantMessage(runtime, messageId, role) : false;
  const assistantMessageHasStopSignal =
    messageId && isAssistantRole
      ? hasMessageStopSignal({
          finish,
          rawParts,
          parts: getKnownMessageParts(runtime, messageId),
        })
      : false;
  const assistantMessageSettled =
    messageId && isAssistantRole
      ? isAssistantMessageSettled({
          messageCompletedAt,
          hasStopSignal: assistantMessageHasStopSignal,
        })
      : false;

  if (messageId && isAssistantRole) {
    updateAssistantMessageCompletionState(runtime, messageId, assistantMessageSettled);
  }

  const normalizedParts: Part[] = [];
  if (messageId && rawParts.length > 0) {
    for (const rawPart of rawParts) {
      const rawPartRecord = asUnknownRecord(rawPart);
      if (!rawPartRecord) {
        continue;
      }

      const rawPartId = readStringProp(rawPartRecord, ["id"]);
      if (!rawPartId) {
        continue;
      }

      const normalizedPart = normalizeMessagePart(
        rawPartRecord,
        messageId,
        runtime.externalSessionId,
      );
      const partWithPendingDelta = applyPendingDeltas(runtime, rawPartId, normalizedPart);

      runtime.partsById.set(rawPartId, partWithPendingDelta);
      normalizedParts.push(partWithPendingDelta);
      emitAssistantPart(runtime, partWithPendingDelta, role);
    }
  }

  if (
    messageId &&
    isAssistantRole &&
    previousRole !== "assistant" &&
    normalizedParts.length === 0
  ) {
    emitKnownAssistantPartsForMessage(runtime, messageId, role);
  }

  if (messageId && role === "user") {
    const userParts =
      normalizedParts.length > 0 ? normalizedParts : getKnownMessageParts(runtime, messageId);
    const currentMetadata = session?.messageMetadataById.get(messageId);
    const normalizedDisplayParts = normalizeUserMessageDisplayParts(userParts);
    const fallbackText = currentMetadata?.text ?? readTextFromMessageInfo(infoRecord);
    const matchedQueuedSend = takeQueuedUserSendMatch(
      runtime,
      fallbackText,
      normalizedDisplayParts,
      messageModel,
    );
    const { displayParts, visible } = buildVisibleUserMessage({
      fallbackText,
      normalizedDisplayParts,
      ...(currentMetadata ? { metadata: currentMetadata } : {}),
      ...(matchedQueuedSend ? { matchedQueuedSend } : {}),
    });
    if (visible.trim().length === 0 && displayParts.length === 0) {
      return true;
    }

    persistUserMessageMetadata({
      session,
      messageId,
      timestamp: messageTimestamp,
      ...(currentMetadata ? { metadata: currentMetadata } : {}),
      ...(messageModel ? { model: messageModel } : {}),
      visible,
      displayParts,
    });

    const explicitState = readExplicitUserMessageState(infoRecord, properties);
    return emitUserMessage(runtime, {
      messageId,
      timestamp: messageTimestamp,
      message: visible,
      parts: displayParts,
      state: resolveLiveUserMessageState(runtime, {
        messageId,
        visible,
        parts: displayParts,
        matchedQueuedSend,
        ...(explicitState ? { explicitState } : {}),
        ...(messageModel ? { model: messageModel } : {}),
      }),
      ...(messageModel ? { model: messageModel } : {}),
    });
  }

  if (!messageId || !isAssistantRole) {
    return true;
  }

  maybeEmitCompletedAssistantMessage(runtime, {
    messageId,
    timestamp: messageTimestamp,
    info: infoRecord,
    hasStopSignal: assistantMessageHasStopSignal,
  });
  return true;
};

const handleMessagePartDeltaEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.delta") {
    return false;
  }

  const deltaEvent = readEventProperties(event);
  if (!deltaEvent) {
    return true;
  }
  const partId = readStringProp(deltaEvent, ["partID", "partId", "part_id"]) ?? "";
  const messageId = readStringProp(deltaEvent, ["messageID", "messageId", "message_id"]);
  const field = readStringProp(deltaEvent, ["field"]) ?? "";
  const deltaValue = readUnknownProp(deltaEvent, "delta");
  const delta = typeof deltaValue === "string" ? deltaValue : "";

  const knownPart = partId ? runtime.partsById.get(partId) : undefined;
  if (knownPart && field.length > 0) {
    const updatedPart = applyDeltaToPart(knownPart, field, delta);
    if (updatedPart) {
      runtime.partsById.set(partId, updatedPart);
      emitAssistantPart(runtime, updatedPart);
      maybeEmitCompletedAssistantMessage(runtime, {
        messageId: updatedPart.messageID,
      });
      return true;
    }
  }

  if (partId && field.length > 0) {
    const pending = runtime.pendingDeltasByPartId.get(partId) ?? [];
    pending.push({ field, delta });
    runtime.pendingDeltasByPartId.set(partId, pending);
    return true;
  }

  if (delta.length === 0) {
    return true;
  }
  if (!messageId) {
    return true;
  }
  const deltaRole = runtime.messageRoleById.get(messageId);
  if (deltaRole !== "assistant") {
    return true;
  }
  if (shouldSuppressAssistantStreamingAfterIdle(runtime, messageId, deltaRole)) {
    return true;
  }
  const channel = isReasoningDeltaField(field) ? "reasoning" : "text";

  markSessionActive(runtime);

  runtime.emit(runtime.sessionId, {
    type: "assistant_delta",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    channel,
    messageId,
    delta,
  });
  return true;
};

const handleMessagePartUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  const rawPartRecord = properties ? readEventPart(properties) : undefined;
  if (!rawPartRecord) {
    return true;
  }

  const partId = readStringProp(rawPartRecord, ["id"]);
  if (!partId) {
    return true;
  }

  const current = rawPartRecord as Part;
  const nextPart = applyPendingDeltas(runtime, partId, current);
  runtime.partsById.set(partId, nextPart);
  emitAssistantPart(runtime, nextPart);
  const messageId = nextPart.messageID;
  const role = runtime.messageRoleById.get(messageId);
  if (role === "assistant") {
    maybeEmitCompletedAssistantMessage(runtime, {
      messageId,
    });
    return true;
  }
  if (role === "user") {
    const session = runtime.getSession(runtime.sessionId);
    const metadata = session?.messageMetadataById.get(messageId);
    const normalizedDisplayParts = normalizeUserMessageDisplayParts(
      getKnownMessageParts(runtime, messageId),
    );
    const fallbackText = metadata?.text ?? "";
    const { displayParts, visible } = buildVisibleUserMessage({
      fallbackText,
      normalizedDisplayParts,
      ...(metadata ? { metadata } : {}),
    });
    if (visible.trim().length > 0 || displayParts.length > 0) {
      persistUserMessageMetadata({
        session,
        messageId,
        timestamp: runtime.now(),
        ...(metadata ? { metadata } : {}),
        ...(metadata?.model ? { model: metadata.model } : {}),
        visible,
        displayParts,
      });
    }
    emitKnownUserMessage(runtime, {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: resolveLiveUserMessageState(runtime, {
        messageId,
        visible,
        parts: displayParts,
        matchedQueuedSend: null,
        ...(metadata?.model ? { model: metadata.model } : {}),
      }),
      ...(metadata?.model ? { model: metadata.model } : {}),
    });
  }
  return true;
};

const handleMessagePartRemovedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.removed") {
    return false;
  }

  const properties = readEventProperties(event);
  const removedPartId = properties
    ? readStringProp(properties, ["partID", "partId", "part_id"])
    : undefined;
  if (!removedPartId) {
    return true;
  }

  runtime.partsById.delete(removedPartId);
  runtime.pendingDeltasByPartId.delete(removedPartId);
  return true;
};

export const handleMessageEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleMessageUpdatedEvent(event, runtime) ||
    handleMessagePartDeltaEvent(event, runtime) ||
    handleMessagePartUpdatedEvent(event, runtime) ||
    handleMessagePartRemovedEvent(event, runtime)
  );
};
