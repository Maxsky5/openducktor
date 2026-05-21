import type {
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
  parseNotificationRecord,
} from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  extractStringField,
  isPlainObject,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
} from "./codex-app-server-shared";
import { codexThreadStatusSnapshot } from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexItemId,
  codexItemTypeMatches,
  codexUserInputListToText,
  codexUserInputsFromItem,
  codexUserInputToDisplayPart,
  extractCodexTokenUsageTotals,
  shouldReplaceCodexBufferedFinalAgentMessage,
  timestampFromCodexParams,
  toCodexUserInputList,
  toDisplayParts,
  toStreamPart,
} from "./codex-app-server-transcript";
import type { CodexCanonicalEvent } from "./codex-canonical-events";
import {
  latestTodosFromCanonicalEvents,
  projectCodexCanonicalEvents,
} from "./codex-canonical-projector";
import type { CodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import type { CodexNotificationRecord, CodexSessionState } from "./types";

export type CompletedAgentMessage = {
  session: CodexSessionState;
  item: Record<string, unknown>;
  timestamp: string;
  model?: AgentModelSelection;
};

export type CodexStreamingContext = {
  subscribeEvents: boolean;
  drainNotifications?: (runtimeId: string) => Promise<unknown[]>;
  bufferedNotificationsByThreadId: Map<string, CodexNotificationRecord[]>;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  syntheticUserMessageTextsByThreadId: Map<string, string[]>;
  completedAgentMessagesByTurnKey: Map<string, CompletedAgentMessage>;
  tokenUsageByTurnKey: Map<string, CodexTokenUsageTotals>;
  modelByTurnKey: Map<string, AgentModelSelection>;
  eventBacklogBySessionId: Map<string, AgentEvent[]>;
  latestTodosBySessionId: Map<string, AgentSessionTodoItem[]>;
  eventMapperPipeline: CodexEventMapperPipeline;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string): boolean;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
  bufferNotification(notification: CodexNotificationRecord): void;
  listenersForSession(externalSessionId: string): Set<(event: AgentEvent) => void> | undefined;
};

const modelForTurn = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  turnId: string | null,
): AgentModelSelection | undefined =>
  turnId ? context.modelByTurnKey.get(codexTurnKey(session.threadId, turnId)) : undefined;

const bufferSessionEvent = (
  context: CodexStreamingContext,
  externalSessionId: string,
  event: AgentEvent,
): void => {
  // Pending input is stateful and exposed through presence snapshots; buffering it here would
  // duplicate events for late listeners after the request has already been resolved.
  if (event.type === "approval_required" || event.type === "question_required") {
    return;
  }
  const backlog = context.eventBacklogBySessionId.get(externalSessionId) ?? [];
  backlog.push(event);
  if (backlog.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
    backlog.splice(0, backlog.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
  }
  context.eventBacklogBySessionId.set(externalSessionId, backlog);
};

export const emitCodexSessionEvent = (
  context: CodexStreamingContext,
  externalSessionId: string,
  event: AgentEvent,
): void => {
  const listeners = context.listenersForSession(externalSessionId);
  if (!listeners) {
    bufferSessionEvent(context, externalSessionId, event);
    return;
  }
  for (const listener of listeners) {
    listener(event);
  }
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

export const emitCodexUserMessage = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  parts: AgentUserMessagePart[],
  model: AgentModelSelection | undefined,
): void => {
  const message = serializeAgentUserMessagePartsToText(parts);
  if (context.subscribeEvents) {
    const codexEchoText = codexUserInputListToText(toCodexUserInputList(parts));
    const pendingTexts = context.syntheticUserMessageTextsByThreadId.get(session.threadId) ?? [];
    pendingTexts.push(codexEchoText);
    if (pendingTexts.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
      pendingTexts.splice(0, pendingTexts.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
    }
    context.syntheticUserMessageTextsByThreadId.set(session.threadId, pendingTexts);
  }
  emitCodexSessionEvent(context, session.threadId, {
    type: "user_message",
    externalSessionId: session.threadId,
    timestamp: new Date().toISOString(),
    messageId: `codex-user-${Date.now()}`,
    message,
    parts: toDisplayParts(parts),
    state: "read",
    ...(model ? { model } : {}),
  });
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
  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_started", item },
    { source: "live", threadId: session.threadId, timestamp },
  );
  for (const event of projectCodexCanonicalEvents(canonicalEvents)) {
    if (event.type !== "assistant_part") {
      emitCodexSessionEvent(context, session.threadId, event);
      continue;
    }
    if (event.part.kind !== "tool") {
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
      parts: input.map(codexUserInputToDisplayPart),
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

  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_completed", item },
    {
      source: "live",
      threadId: session.threadId,
      ...(turnId ? { turnId } : {}),
      timestamp,
    },
  );
  if (canonicalEvents.length > 0) {
    emitCanonicalEvents(context, withTurnModel(context, canonicalEvents, session, turnId));
    return;
  }

  const parts = toStreamPart(item, itemId, itemId);
  for (const part of parts) {
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp,
      part,
    });
  }
};

export const handleCodexPendingNotifications = async (
  context: CodexStreamingContext,
  session: CodexSessionState,
  notificationsFromBatch?: unknown[],
): Promise<void> => {
  const bufferedNotifications = context.bufferedNotificationsByThreadId.get(session.threadId) ?? [];
  context.bufferedNotificationsByThreadId.delete(session.threadId);
  const drainedNotifications = notificationsFromBatch
    ? notificationsFromBatch.map(parseNotificationRecord)
    : context.drainNotifications
      ? (await context.drainNotifications(session.runtimeId)).map(parseNotificationRecord)
      : [];
  const notifications = [...bufferedNotifications, ...drainedNotifications];
  for (const notification of notifications) {
    const notificationThreadId = extractThreadIdFromParams(notification.params);
    if (notificationThreadId && notificationThreadId !== session.threadId) {
      context.bufferNotification(notification);
      continue;
    }
    const timestamp = timestampFromCodexParams(notification.params);
    const notificationTurnId = extractTurnId(notification.params);
    const activeTurn = context.activeTurnsBySessionId.get(session.threadId);
    if (
      notificationTurnId &&
      activeTurn &&
      context.bindActiveTurnId(activeTurn, notificationTurnId)
    ) {
      context.flushQueuedUserMessagesLater(activeTurn);
    }

    if (notification.method === "turn/started") {
      session.liveStatus = {
        classification: "running",
        status: { type: "busy" },
        agentSessionStatus: "running",
      };
      const turn = isPlainObject(notification.params) ? notification.params.turn : null;
      const turnId = isPlainObject(turn) ? extractStringField(turn, ["id", "turnId"]) : null;
      if (turnId && activeTurn && context.bindActiveTurnId(activeTurn, turnId)) {
        context.flushQueuedUserMessagesLater(activeTurn);
      }
      continue;
    }

    if (notification.method === "thread/status/changed") {
      if (isPlainObject(notification.params)) {
        session.liveStatus = codexThreadStatusSnapshot(notification.params.status);
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
            { source: "live", threadId: session.threadId, turnId: usageTurnId, timestamp },
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
            { source: "live", threadId: session.threadId, turnId: todoTurnId, timestamp },
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
      activeTurn?.markTurnSettled();
      session.liveStatus = {
        classification: "idle",
        status: { type: "idle" },
        agentSessionStatus: "idle",
      };
      emitCanonicalEvents(
        context,
        context.eventMapperPipeline.runLive(
          { kind: "notification", notification },
          {
            source: "live",
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
