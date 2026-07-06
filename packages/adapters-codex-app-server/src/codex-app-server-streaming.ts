import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentUserMessagePart,
} from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";
import {
  codexTurnKey,
  extractThreadIdFromParams,
  extractTurnId,
} from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  extractStringField,
  isPlainObject,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
} from "./codex-app-server-shared";
import {
  type CodexThreadStatusSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexItemId,
  codexItemTypeMatches,
  extractCodexTokenUsageTotals,
  shouldReplaceCodexBufferedFinalAgentMessage,
  timestampFromCodexParams,
  timestampFromCodexTurn,
  toStreamPart,
} from "./codex-app-server-transcript";
import type { CodexCanonicalEvent } from "./codex-canonical-events";
import {
  latestTodosFromCanonicalEvents,
  projectCodexCanonicalEvents,
} from "./codex-canonical-projector";
import type { CodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import {
  codexUserInputListToText,
  codexUserInputsToDisplayParts,
  toDisplayParts,
} from "./codex-user-input-display";
import { codexUserInputsFromItem, toCodexUserInputList } from "./codex-user-inputs";
import type { CodexNotificationRecord, CodexSessionState } from "./types";

export type CompletedAgentMessage = {
  session: CodexSessionState;
  item: Record<string, unknown>;
  timestamp: string;
  model?: AgentModelSelection;
};

export type CodexStreamingContext = {
  subscribeEvents: boolean;
  bufferedNotificationsByThreadId: Map<string, CodexNotificationRecord[]>;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  startedItemTimestampsByKey: Map<string, number>;
  syntheticUserMessageTextsByThreadId: Map<string, string[]>;
  completedAgentMessagesByTurnKey: Map<string, CompletedAgentMessage>;
  tokenUsageByTurnKey: Map<string, CodexTokenUsageTotals>;
  modelByTurnKey: Map<string, AgentModelSelection>;
  latestTodosBySessionId: Map<string, AgentSessionTodoItem[]>;
  eventMapperPipeline: CodexEventMapperPipeline;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): boolean;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
  bufferNotification(notification: CodexNotificationRecord): void;
  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void;
};

const modelForTurn = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  turnId: string | null,
): AgentModelSelection | undefined =>
  turnId ? context.modelByTurnKey.get(codexTurnKey(session.threadId, turnId)) : undefined;

const emitCodexSessionEvent = (
  context: CodexStreamingContext,
  externalSessionId: string,
  event: AgentEvent,
): void => {
  context.emitSessionEvent(externalSessionId, event);
};

const withTurnModel = (
  context: CodexStreamingContext,
  events: CodexCanonicalEvent[],
  session: CodexSessionState,
  turnId: string | null,
): CodexCanonicalEvent[] => {
  const model = modelForTurn(context, session, turnId);
  if (!model) {
    return events;
  }
  return events.map((event) => {
    if ((event.kind === "user_message" || event.kind === "assistant_message") && !event.model) {
      return { ...event, model };
    }
    return event;
  });
};

const emitCanonicalEvents = (
  context: CodexStreamingContext,
  events: CodexCanonicalEvent[],
): void => {
  const todos = latestTodosFromCanonicalEvents(events);
  if (todos) {
    const threadId = events.find((event) => event.kind === "todo_update")?.threadId;
    if (threadId) {
      context.latestTodosBySessionId.set(threadId, todos);
    }
  }
  for (const event of projectCodexCanonicalEvents(events)) {
    emitCodexSessionEvent(context, event.externalSessionId, event);
  }
};

const consumeSyntheticUserMessage = (
  context: CodexStreamingContext,
  externalSessionId: string,
  message: string,
): boolean => {
  const pendingTexts = context.syntheticUserMessageTextsByThreadId.get(externalSessionId);
  if (!pendingTexts || pendingTexts.length === 0) {
    return false;
  }
  const normalizedMessage = normalizeSyntheticUserMessageText(message);
  const index = pendingTexts.findIndex(
    (pendingText) => normalizeSyntheticUserMessageText(pendingText) === normalizedMessage,
  );
  if (index === -1) {
    return false;
  }
  pendingTexts.splice(index, 1);
  if (pendingTexts.length === 0) {
    context.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
  }
  return true;
};

const normalizeSyntheticUserMessageText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

const withLifecycleTimestamp = (
  item: Record<string, unknown>,
  key: "startedAtMs" | "completedAtMs",
  timestamp: string,
): Record<string, unknown> => {
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? { ...item, [key]: timestampMs } : item;
};

const lifecycleItemKey = (
  session: CodexSessionState,
  item: Record<string, unknown>,
): string | null => {
  const itemId = extractStringField(item, ["id"]);
  return itemId ? `${session.runtimeId}:${session.threadId}:${itemId}` : null;
};

const recordStartedItemTimestamp = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: Record<string, unknown>,
  timestamp: string,
): void => {
  const itemKey = lifecycleItemKey(session, item);
  if (!itemKey) {
    return;
  }
  const startedAtMs = Date.parse(timestamp);
  if (Number.isFinite(startedAtMs)) {
    context.startedItemTimestampsByKey.set(itemKey, startedAtMs);
  }
};

const withRecordedStartedItemTimestamp = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: Record<string, unknown>,
): Record<string, unknown> => {
  const itemKey = lifecycleItemKey(session, item);
  if (!itemKey) {
    return item;
  }
  const startedAtMs = context.startedItemTimestampsByKey.get(itemKey);
  context.startedItemTimestampsByKey.delete(itemKey);
  if (
    typeof startedAtMs !== "number" ||
    Object.hasOwn(item, "startedAtMs") ||
    Object.hasOwn(item, "started_at_ms")
  ) {
    return item;
  }
  return { ...item, startedAtMs };
};

let lastAcceptedUserMessageTimestamp = 0;
let acceptedUserMessageCounter = 0;

const createCodexAcceptedUserMessageId = (timestamp = Date.now()): string => {
  if (timestamp !== lastAcceptedUserMessageTimestamp) {
    lastAcceptedUserMessageTimestamp = timestamp;
    acceptedUserMessageCounter = 0;
  }

  acceptedUserMessageCounter += 1;
  return `codex-user-${timestamp}-${acceptedUserMessageCounter}`;
};

const emitFinalAgentMessage = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: Record<string, unknown>,
  timestamp: string,
  tokenUsage?: CodexTokenUsageTotals,
  model?: AgentModelSelection,
): void => {
  const itemId = codexItemId(item, `codex-item-${Date.now()}`);
  const text = extractStringField(item, ["text"]);
  if (text) {
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_message",
      externalSessionId: session.threadId,
      timestamp,
      messageId: itemId,
      message: text,
      ...(typeof tokenUsage?.totalTokens === "number"
        ? { totalTokens: tokenUsage.totalTokens }
        : {}),
      ...(typeof tokenUsage?.contextWindow === "number"
        ? { contextWindow: tokenUsage.contextWindow }
        : {}),
      ...(model ? { model } : {}),
    });
  }
};

export const createCodexAcceptedUserMessage = ({
  session,
  parts,
  model,
}: {
  session: CodexSessionState;
  parts: AgentUserMessagePart[];
  model: AgentModelSelection | undefined;
}): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: session.threadId,
  timestamp: new Date().toISOString(),
  messageId: createCodexAcceptedUserMessageId(),
  message: serializeAgentUserMessagePartsToText(parts),
  parts: toDisplayParts(parts),
  state: "read",
  ...(model ? { model } : {}),
});

export const emitCodexUserMessage = (
  context: CodexStreamingContext,
  event: AcceptedAgentUserMessage,
  sourceParts: AgentUserMessagePart[],
): AcceptedAgentUserMessage => {
  if (context.subscribeEvents) {
    const codexEchoText = codexUserInputListToText(toCodexUserInputList(sourceParts));
    const pendingTexts =
      context.syntheticUserMessageTextsByThreadId.get(event.externalSessionId) ?? [];
    pendingTexts.push(codexEchoText);
    if (pendingTexts.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      pendingTexts.splice(0, pendingTexts.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    context.syntheticUserMessageTextsByThreadId.set(event.externalSessionId, pendingTexts);
  }
  emitCodexSessionEvent(context, event.externalSessionId, event);
  return event;
};

const emitStartedItem = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: Record<string, unknown>,
  timestamp: string,
): void => {
  if (
    codexItemTypeMatches(item, "userMessage") ||
    codexItemTypeMatches(item, "agentMessage") ||
    codexItemTypeMatches(item, "reasoning") ||
    codexItemTypeMatches(item, "hookPrompt")
  ) {
    return;
  }
  const startedItem = withLifecycleTimestamp(item, "startedAtMs", timestamp);
  recordStartedItemTimestamp(context, session, startedItem, timestamp);
  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_started", item: startedItem },
    { source: "live", runtimeId: session.runtimeId, threadId: session.threadId, timestamp },
  );
  for (const event of projectCodexCanonicalEvents(canonicalEvents)) {
    if (event.type !== "assistant_part") {
      emitCodexSessionEvent(context, session.threadId, event);
      continue;
    }
    if (event.part.kind !== "tool") {
      emitCodexSessionEvent(context, session.threadId, event);
      continue;
    }
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp,
      part: {
        ...event.part,
        status: event.part.status === "completed" ? "running" : event.part.status,
      },
    });
  }
};

const emitCompletedItem = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: Record<string, unknown>,
  timestamp: string,
  turnId: string | null,
): void => {
  const itemId = extractStringField(item, ["id"]) ?? `codex-item-${Date.now()}`;
  if (codexItemTypeMatches(item, "userMessage")) {
    const input = codexUserInputsFromItem(item);
    const message = codexUserInputListToText(input);
    if (consumeSyntheticUserMessage(context, session.threadId, message)) {
      return;
    }
    const model =
      modelForTurn(context, session, turnId) ??
      context.activeTurnsBySessionId.get(session.threadId)?.model;
    emitCodexSessionEvent(context, session.threadId, {
      type: "user_message",
      externalSessionId: session.threadId,
      timestamp,
      messageId: itemId,
      message,
      parts: codexUserInputsToDisplayParts(input, itemId),
      state: "read",
      ...(model ? { model } : {}),
    });
    return;
  }

  if (codexItemTypeMatches(item, "hookPrompt")) {
    return;
  }

  if (codexItemTypeMatches(item, "agentMessage")) {
    const text = extractStringField(item, ["text"]);
    if (text) {
      emitCodexSessionEvent(context, session.threadId, {
        type: "assistant_part",
        externalSessionId: session.threadId,
        timestamp,
        part: {
          kind: "text",
          messageId: itemId,
          partId: `${itemId}-text`,
          text,
          completed: true,
        },
      });
      if (turnId) {
        const turnKey = codexTurnKey(session.threadId, turnId);
        const existing = context.completedAgentMessagesByTurnKey.get(turnKey);
        if (!existing || shouldReplaceCodexBufferedFinalAgentMessage(existing.item, item)) {
          const model = modelForTurn(context, session, turnId);
          context.completedAgentMessagesByTurnKey.set(turnKey, {
            session,
            item,
            timestamp,
            ...(model ? { model } : {}),
          });
        }
      }
    }
    return;
  }

  const completedItem = withLifecycleTimestamp(
    withRecordedStartedItemTimestamp(context, session, item),
    "completedAtMs",
    timestamp,
  );
  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_completed", item: completedItem },
    {
      source: "live",
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      ...(turnId ? { turnId } : {}),
      timestamp,
    },
  );
  if (canonicalEvents.length > 0) {
    emitCanonicalEvents(context, withTurnModel(context, canonicalEvents, session, turnId));
    return;
  }

  const parts = toStreamPart(completedItem, itemId, itemId);
  for (const part of parts) {
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp,
      part,
    });
  }
};

const requiresRuntimeLifecycleTimestamp = (method: string): boolean =>
  method === "item/started" || method === "item/completed";

const isThreadScopedCodexNotificationMethod = (method: string): boolean =>
  method.startsWith("thread/") || method.startsWith("turn/") || method.startsWith("item/");

const timestampFromCompletedTurnNotification = (
  notification: CodexNotificationRecord,
): string | null => {
  if (notification.method !== "turn/completed" || !isPlainObject(notification.params)) {
    return null;
  }

  return timestampFromCodexTurn(notification.params.turn, ["completedAt", "completed_at"]);
};

const timestampFromCodexNotification = (notification: CodexNotificationRecord): string => {
  const paramsTimestamp = timestampFromCodexParams(notification.params);
  if (paramsTimestamp) {
    return paramsTimestamp;
  }

  const completedTurnTimestamp = timestampFromCompletedTurnNotification(notification);
  if (completedTurnTimestamp) {
    return completedTurnTimestamp;
  }

  if (requiresRuntimeLifecycleTimestamp(notification.method)) {
    throw new Error(
      `Codex notification '${notification.method}' is missing its runtime lifecycle timestamp.`,
    );
  }

  return notification.receivedAt;
};

const isCodexIdleThreadStatus = (status: unknown): boolean => {
  const type = isPlainObject(status)
    ? extractStringField(status, ["type"])
    : typeof status === "string"
      ? status
      : null;
  return type?.toLowerCase() === "idle";
};

const receivedAtMsFromCodexNotification = (receivedAt: string): number => {
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    throw new Error(`Codex notification has an unparsable receivedAt timestamp '${receivedAt}'.`);
  }
  return receivedAtMs;
};

const isNotificationAtOrAfterActiveTurnStart = (
  receivedAt: string,
  activeTurn: ActiveCodexTurn,
): boolean => {
  const receivedAtMs = receivedAtMsFromCodexNotification(receivedAt);
  return receivedAtMs >= activeTurn.startedAtMs;
};

export const handleCodexPendingNotifications = async (
  context: CodexStreamingContext,
  session: CodexSessionState,
  notificationsFromBatch?: CodexNotificationRecord[],
): Promise<void> => {
  const bufferedNotifications = context.bufferedNotificationsByThreadId.get(session.threadId) ?? [];
  context.bufferedNotificationsByThreadId.delete(session.threadId);
  const takenNotifications = notificationsFromBatch ?? [];
  const notifications = [...bufferedNotifications, ...takenNotifications];
  for (const notification of notifications) {
    const notificationThreadId = extractThreadIdFromParams(notification.params);
    if (!notificationThreadId) {
      if (!isThreadScopedCodexNotificationMethod(notification.method)) {
        continue;
      }
      throw new Error(
        `Codex notification '${notification.method}' is missing params.threadId and cannot be applied to session '${session.threadId}'.`,
      );
    }
    if (notificationThreadId !== session.threadId) {
      context.bufferNotification(notification);
      continue;
    }
    const timestamp = timestampFromCodexNotification(notification);
    const notificationTurnId = extractTurnId(notification.params);
    const activeTurn = context.activeTurnsBySessionId.get(session.threadId);
    if (
      notificationTurnId &&
      activeTurn &&
      context.bindActiveTurnId(
        activeTurn,
        notificationTurnId,
        receivedAtMsFromCodexNotification(notification.receivedAt),
      )
    ) {
      context.flushQueuedUserMessagesLater(activeTurn);
    }

    if (notification.method === "turn/started") {
      context.setSessionLiveStatus(session, {
        classification: "running",
      });
      const turn = isPlainObject(notification.params) ? notification.params.turn : null;
      const turnId = isPlainObject(turn) ? extractStringField(turn, ["id", "turnId"]) : null;
      if (
        turnId &&
        activeTurn &&
        context.bindActiveTurnId(
          activeTurn,
          turnId,
          receivedAtMsFromCodexNotification(notification.receivedAt),
        )
      ) {
        context.flushQueuedUserMessagesLater(activeTurn);
      }
      continue;
    }

    if (notification.method === "thread/status/changed") {
      if (isPlainObject(notification.params)) {
        const isIdleStatus = isCodexIdleThreadStatus(notification.params.status);
        if (
          activeTurn &&
          isIdleStatus &&
          !isNotificationAtOrAfterActiveTurnStart(notification.receivedAt, activeTurn)
        ) {
          continue;
        }
        const liveStatus = codexThreadStatusSnapshot(notification.params.status);
        context.setSessionLiveStatus(session, liveStatus);
        if (activeTurn && isIdleStatus) {
          emitCodexSessionEvent(context, session.threadId, {
            type: "session_idle",
            externalSessionId: session.threadId,
            timestamp: notification.receivedAt,
          });
          activeTurn.markTurnSettled();
        }
      }
      continue;
    }

    if (notification.method === "thread/tokenUsage/updated") {
      const tokenUsage = extractCodexTokenUsageTotals(notification.params);
      const usageTurnId = notificationTurnId ?? activeTurn?.turnId ?? session.threadId;
      if (tokenUsage) {
        context.tokenUsageByTurnKey.set(codexTurnKey(session.threadId, usageTurnId), tokenUsage);
        emitCanonicalEvents(
          context,
          context.eventMapperPipeline.runLive(
            { kind: "notification", notification },
            {
              source: "live",
              runtimeId: session.runtimeId,
              threadId: session.threadId,
              turnId: usageTurnId,
              timestamp,
            },
          ),
        );
      }
      continue;
    }

    if (notification.method === "turn/plan/updated") {
      if (isPlainObject(notification.params)) {
        const todoTurnId = notificationTurnId ?? activeTurn?.turnId ?? session.threadId;
        emitCanonicalEvents(
          context,
          context.eventMapperPipeline.runLive(
            { kind: "notification", notification },
            {
              source: "live",
              runtimeId: session.runtimeId,
              threadId: session.threadId,
              turnId: todoTurnId,
              timestamp,
            },
          ),
        );
      }
      continue;
    }

    if (notification.method !== "turn/completed") {
      const canonicalEvents = context.eventMapperPipeline.runLive(
        { kind: "notification", notification },
        {
          source: "live",
          runtimeId: session.runtimeId,
          threadId: session.threadId,
          ...(notificationTurnId ? { turnId: notificationTurnId } : {}),
          timestamp,
        },
      );
      if (canonicalEvents.length > 0) {
        emitCanonicalEvents(
          context,
          withTurnModel(context, canonicalEvents, session, notificationTurnId),
        );
        continue;
      }
    }

    if (notification.method === "turn/completed") {
      const turn = isPlainObject(notification.params) ? notification.params.turn : null;
      const turnId = isPlainObject(turn) ? extractStringField(turn, ["id", "turnId"]) : null;
      if (turnId && isPlainObject(turn) && turn.status === "completed") {
        const turnKey = codexTurnKey(session.threadId, turnId);
        const bufferedAgentMessage = context.completedAgentMessagesByTurnKey.get(turnKey);
        if (bufferedAgentMessage) {
          emitFinalAgentMessage(
            context,
            bufferedAgentMessage.session,
            bufferedAgentMessage.item,
            bufferedAgentMessage.timestamp,
            context.tokenUsageByTurnKey.get(turnKey),
            bufferedAgentMessage.model ?? modelForTurn(context, session, turnId),
          );
          context.completedAgentMessagesByTurnKey.delete(turnKey);
        }
        context.tokenUsageByTurnKey.delete(turnKey);
        context.modelByTurnKey.delete(turnKey);
      } else if (turnId) {
        const turnKey = codexTurnKey(session.threadId, turnId);
        context.completedAgentMessagesByTurnKey.delete(turnKey);
        context.tokenUsageByTurnKey.delete(turnKey);
        context.modelByTurnKey.delete(turnKey);
      }
      const shouldSettleActiveTurn = activeTurn && (!turnId || activeTurn.turnId === turnId);
      if (shouldSettleActiveTurn) {
        activeTurn.markTurnSettled();
      }
      if (!activeTurn || shouldSettleActiveTurn) {
        context.setSessionLiveStatus(session, {
          classification: "idle",
        });
      }
      emitCanonicalEvents(
        context,
        context.eventMapperPipeline.runLive(
          { kind: "notification", notification },
          {
            source: "live",
            runtimeId: session.runtimeId,
            threadId: session.threadId,
            ...(turnId ? { turnId } : {}),
            timestamp,
          },
        ),
      );
      continue;
    }

    if (notification.method === "item/agentMessage/delta") {
      const delta = extractStringField(notification.params, ["delta"]);
      if (delta) {
        const messageId = extractStringField(notification.params, ["itemId", "item_id"]);
        emitCodexSessionEvent(context, session.threadId, {
          type: "assistant_delta",
          externalSessionId: session.threadId,
          timestamp,
          channel: "text",
          ...(messageId ? { messageId } : {}),
          delta,
        });
      }
      continue;
    }

    if (
      notification.method === "item/reasoningText/delta" ||
      notification.method === "item/reasoningSummaryText/delta" ||
      notification.method === "item/reasoning/textDelta" ||
      notification.method === "item/reasoning/summaryTextDelta"
    ) {
      const delta = extractStringField(notification.params, ["delta"]);
      if (delta) {
        const messageId = extractStringField(notification.params, ["itemId", "item_id"]);
        emitCodexSessionEvent(context, session.threadId, {
          type: "assistant_delta",
          externalSessionId: session.threadId,
          timestamp,
          channel: "reasoning",
          ...(messageId ? { messageId } : {}),
          delta,
        });
      }
      continue;
    }

    if (notification.method === "item/started") {
      const item = isPlainObject(notification.params) ? notification.params.item : null;
      if (isPlainObject(item)) {
        emitStartedItem(context, session, item, timestamp);
      }
      continue;
    }

    if (notification.method === "item/completed") {
      const item = isPlainObject(notification.params) ? notification.params.item : null;
      if (isPlainObject(item)) {
        emitCompletedItem(context, session, item, timestamp, notificationTurnId);
      }
    }
  }
};
