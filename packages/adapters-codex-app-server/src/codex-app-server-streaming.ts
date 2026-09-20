import type { CodexImageGenerationEnd } from "./codex-image-generation-state";
import type {
  AgentImageGenerationPart,
  CodexAppServerThreadStatus,
  CodexAppServerTurn,
} from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessagePart,
} from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";
import {
  codexNotificationThreadId,
  codexNotificationTurnId,
  codexTurnKey,
} from "./codex-app-server-requests";
import {
  type ActiveCodexTurn,
  MAX_CODEX_EVENT_BACKLOG_PER_SESSION,
} from "./codex-app-server-shared";
import {
  type CodexThreadStatusSnapshot,
  codexThreadStatusSnapshot,
} from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  codexItemTypeMatches,
  extractCodexTokenUsageTotals,
  shouldReplaceCodexBufferedFinalAgentMessage,
  timestampFromCodexTurn,
  toStreamPart,
} from "./codex-app-server-transcript";
import { safeCodexTimestampFromMilliseconds } from "./codex-tool-timing";
import type { CodexCanonicalEvent, CodexMappingContext } from "./codex-canonical-events";
import {
  latestTodosFromCanonicalEvents,
  projectCodexCanonicalEvents,
} from "./codex-canonical-projector";
import type { CodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import type { CodexTimedThreadItem } from "./codex-event-mapper";
import { codexUserInputListToText, toDisplayParts } from "./codex-user-input-display";
import { codexUserInputsFromItem } from "./codex-user-inputs";
import type { CodexNotificationRecord, CodexSessionState, CodexUserInput } from "./types";
import { type CodexAsyncQuestionState, parseCodexAsyncQuestionItem } from "./codex-async-questions";

type CodexAgentMessageItem = Extract<CodexTimedThreadItem, { type: "agentMessage" }>;

const CODEX_SAFETY_BUFFERING_MESSAGE =
  "Our systems are thinking a bit more about this request before responding.";
const CODEX_UNLINKED_SPAWN_ERROR = "Codex ended this subagent spawn without creating a session.";

export type CompletedAgentMessage = {
  session: CodexSessionState;
  item: CodexAgentMessageItem;
  timestamp: string;
  model?: AgentModelSelection;
};

export type CodexUserMessageEcho = {
  readonly text: string;
};

export type CodexStreamingContext = {
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  syntheticUserMessageEchoesByThreadId: Map<string, CodexUserMessageEcho[]>;
  completedAgentMessagesByTurnKey: Map<string, CompletedAgentMessage>;
  tokenUsageByTurnKey: Map<string, CodexTokenUsageTotals>;
  modelByTurnKey: Map<string, AgentModelSelection>;
  latestTodosBySessionId: Map<string, AgentSessionTodoItem[]>;
  eventMapperPipeline: CodexEventMapperPipeline;
  asyncQuestions: CodexAsyncQuestionState;
  runtimeIdForThread(threadId: string): string | undefined;
  startImageGenerationTurn(session: CodexSessionState, turnId: string, timestamp: string): void;
  settleImageGenerations(session: CodexSessionState, end: CodexImageGenerationEnd): void;
  recordStartedItemTimestamp(
    runtimeId: string,
    threadId: string,
    itemId: string,
    startedAtMs: number,
  ): void;
  takeStartedItemTimestamp(runtimeId: string, threadId: string, itemId: string): number | undefined;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): boolean;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void;
  failUnlinkedSubagentSpawns(
    parentThreadId: string,
    runtimeId: string,
    error: string,
  ): AgentStreamPart[];
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
  for (const event of events) {
    if (event.kind === "assistant_message" && event.questionRequest) {
      const runtimeId = context.runtimeIdForThread(event.threadId);
      if (!runtimeId) continue;
      context.asyncQuestions.add(runtimeId, event.threadId, event.questionRequest);
      emitCodexSessionEvent(context, event.threadId, {
        ...event.questionRequest,
        type: "question_required",
        externalSessionId: event.threadId,
        timestamp: event.timestamp ?? new Date().toISOString(),
      });
    }
    if (event.kind === "user_message") {
      const runtimeId = context.runtimeIdForThread(event.threadId);
      if (!runtimeId) continue;
      const resolvedQuestionRequestIds =
        event.resolvedQuestionRequestIds ??
        context.asyncQuestions
          .pendingForSession(runtimeId, event.threadId)
          .map((request) => request.requestId);
      context.asyncQuestions.resolve(runtimeId, event.threadId, resolvedQuestionRequestIds);
      for (const requestId of resolvedQuestionRequestIds) {
        emitCodexSessionEvent(context, event.threadId, {
          type: "question_resolved",
          requestId,
          externalSessionId: event.threadId,
          timestamp: event.timestamp ?? new Date().toISOString(),
        });
      }
    }
  }
  const liveEvents = events.filter(
    (event) => event.kind !== "assistant_message" || event.questionRequest === undefined,
  );
  for (const event of projectCodexCanonicalEvents(liveEvents)) {
    emitCodexSessionEvent(context, event.externalSessionId, event);
  }
};

const emitUnlinkedSpawnFailures = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  timestamp: string,
): void => {
  const parts = context.failUnlinkedSubagentSpawns(
    session.threadId,
    session.runtimeId,
    CODEX_UNLINKED_SPAWN_ERROR,
  );
  for (const part of parts) {
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp,
      part,
    });
  }
};

const consumeSyntheticUserMessage = (
  context: CodexStreamingContext,
  externalSessionId: string,
  message: string,
): boolean => {
  const pendingEchoes = context.syntheticUserMessageEchoesByThreadId.get(externalSessionId);
  if (!pendingEchoes || pendingEchoes.length === 0) {
    return false;
  }
  const normalizedMessage = normalizeSyntheticUserMessageText(message);
  const index = pendingEchoes.findIndex(
    (echo) => normalizeSyntheticUserMessageText(echo.text) === normalizedMessage,
  );
  if (index === -1) {
    return false;
  }
  pendingEchoes.splice(index, 1);
  if (pendingEchoes.length === 0) {
    context.syntheticUserMessageEchoesByThreadId.delete(externalSessionId);
  }
  return true;
};

const normalizeSyntheticUserMessageText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

const recordStartedItemTimestamp = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: CodexTimedThreadItem,
): void => {
  if (item.startedAtMs !== undefined) {
    context.recordStartedItemTimestamp(
      session.runtimeId,
      session.threadId,
      item.id,
      item.startedAtMs,
    );
  }
};

const withRecordedStartedItemTimestamp = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: CodexTimedThreadItem,
): CodexTimedThreadItem => {
  const startedAtMs = context.takeStartedItemTimestamp(
    session.runtimeId,
    session.threadId,
    item.id,
  );
  if (startedAtMs === undefined || item.startedAtMs !== undefined) {
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
  item: CodexAgentMessageItem,
  timestamp: string,
  tokenUsage?: CodexTokenUsageTotals,
  model?: AgentModelSelection,
): void => {
  const itemId = item.id;
  const text = item.text;
  if (text) {
    const event: Extract<AgentEvent, { type: "assistant_message" }> = {
      type: "assistant_message",
      externalSessionId: session.threadId,
      timestamp,
      messageId: itemId,
      message: text,
    };
    if (tokenUsage?.totalTokens !== undefined) {
      event.totalTokens = tokenUsage.totalTokens;
    }
    if (tokenUsage?.contextWindow !== undefined) {
      event.contextWindow = tokenUsage.contextWindow;
    }
    if (model) {
      event.model = model;
    }
    emitCodexSessionEvent(context, session.threadId, event);
  }
};

export const createCodexAcceptedUserMessage = ({
  session,
  parts,
  model,
  resolvedQuestionRequestIds,
}: {
  session: CodexSessionState;
  parts: AgentUserMessagePart[];
  model: AgentModelSelection | undefined;
  resolvedQuestionRequestIds: readonly string[];
}): AcceptedAgentUserMessage => {
  const event: AcceptedAgentUserMessage = {
    type: "user_message",
    externalSessionId: session.threadId,
    timestamp: new Date().toISOString(),
    messageId: createCodexAcceptedUserMessageId(),
    message: serializeAgentUserMessagePartsToText(parts),
    parts: toDisplayParts(parts),
    state: "read",
    resolvedQuestionRequestIds: [...resolvedQuestionRequestIds],
  };

  if (model) {
    event.model = model;
  }

  return event;
};

export const expectCodexUserMessageEcho = (
  context: CodexStreamingContext,
  event: AcceptedAgentUserMessage,
  input: CodexUserInput[],
): (() => void) => {
  const echo: CodexUserMessageEcho = {
    text: codexUserInputListToText(input),
  };
  const pendingEchoes =
    context.syntheticUserMessageEchoesByThreadId.get(event.externalSessionId) ?? [];
  pendingEchoes.push(echo);
  if (pendingEchoes.length > MAX_CODEX_EVENT_BACKLOG_PER_SESSION) {
    pendingEchoes.splice(0, pendingEchoes.length - MAX_CODEX_EVENT_BACKLOG_PER_SESSION);
  }
  context.syntheticUserMessageEchoesByThreadId.set(event.externalSessionId, pendingEchoes);
  return () => {
    const index = pendingEchoes.indexOf(echo);
    if (index === -1) return;
    pendingEchoes.splice(index, 1);
    if (pendingEchoes.length === 0) {
      context.syntheticUserMessageEchoesByThreadId.delete(event.externalSessionId);
    }
  };
};

export const emitCodexUserMessage = (
  context: CodexStreamingContext,
  event: AcceptedAgentUserMessage,
): AcceptedAgentUserMessage => {
  emitCodexSessionEvent(context, event.externalSessionId, event);
  return event;
};

const emitStartedItem = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  item: CodexTimedThreadItem,
  timestamp: string,
  turnId: string,
  preparedImageGeneration?: AgentImageGenerationPart,
): void => {
  if (
    codexItemTypeMatches(item, "userMessage") ||
    codexItemTypeMatches(item, "agentMessage") ||
    codexItemTypeMatches(item, "reasoning") ||
    codexItemTypeMatches(item, "hookPrompt")
  ) {
    return;
  }
  const startedItem = item;
  recordStartedItemTimestamp(context, session, startedItem);
  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_started", item: startedItem, preparedImageGeneration },
    { source: "live", runtimeId: session.runtimeId, threadId: session.threadId, timestamp, turnId },
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
  item: CodexTimedThreadItem,
  timestamp: string,
  turnId: string | null,
  preparedImageGeneration?: AgentImageGenerationPart,
): void => {
  const itemId = item.id;
  if (codexItemTypeMatches(item, "userMessage")) {
    const input = codexUserInputsFromItem(item);
    const message = codexUserInputListToText(input);
    if (consumeSyntheticUserMessage(context, session.threadId, message)) {
      return;
    }
    const canonicalEvents = context.eventMapperPipeline.runLive(
      { kind: "item_completed", item },
      { source: "live", runtimeId: session.runtimeId, threadId: session.threadId, timestamp },
    );
    emitCanonicalEvents(context, withTurnModel(context, canonicalEvents, session, turnId));
    return;
  }

  if (codexItemTypeMatches(item, "hookPrompt")) {
    return;
  }

  if (codexItemTypeMatches(item, "agentMessage")) {
    const asyncQuestion = parseCodexAsyncQuestionItem(item);
    if (asyncQuestion.kind !== "not_async_question") {
      const canonicalEvents = context.eventMapperPipeline.runLive(
        { kind: "item_completed", item },
        { source: "live", runtimeId: session.runtimeId, threadId: session.threadId, timestamp },
      );
      emitCanonicalEvents(context, withTurnModel(context, canonicalEvents, session, turnId));
      return;
    }
    const text = item.text;
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
          const bufferedMessage: CompletedAgentMessage = {
            session,
            item,
            timestamp,
          };
          if (model) {
            bufferedMessage.model = model;
          }
          context.completedAgentMessagesByTurnKey.set(turnKey, bufferedMessage);
        }
      }
    }
    return;
  }

  const completedItem = withRecordedStartedItemTimestamp(context, session, item);
  const canonicalEvents = context.eventMapperPipeline.runLive(
    { kind: "item_completed", item: completedItem, preparedImageGeneration },
    (() => {
      const mappingContext: CodexMappingContext = {
        source: "live",
        runtimeId: session.runtimeId,
        threadId: session.threadId,
        timestamp,
      };
      if (turnId) {
        mappingContext.turnId = turnId;
      }
      return mappingContext;
    })(),
  );
  if (canonicalEvents.length > 0) {
    emitCanonicalEvents(context, withTurnModel(context, canonicalEvents, session, turnId));
    return;
  }

  const parts = toStreamPart(completedItem, itemId);
  for (const part of parts) {
    emitCodexSessionEvent(context, session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp,
      part,
    });
  }
};

const isThreadScopedCodexNotificationMethod = (method: string): boolean =>
  method.startsWith("thread/") || method.startsWith("turn/") || method.startsWith("item/");

const timestampFromCompletedTurnNotification = (
  notification: CodexNotificationRecord,
): string | null => {
  if (notification.method !== "turn/completed") {
    return null;
  }

  return timestampFromCodexTurn(notification.params.turn, "completedAt");
};

const timestampFromCodexNotification = (notification: CodexNotificationRecord): string => {
  if (notification.method === "item/started") {
    const timestamp = safeCodexTimestampFromMilliseconds(notification.params.startedAtMs);
    if (timestamp) {
      return timestamp;
    }
    throw new Error(
      `Codex notification '${notification.method}' is missing its runtime lifecycle timestamp.`,
    );
  }

  if (notification.method === "item/completed") {
    const timestamp = safeCodexTimestampFromMilliseconds(notification.params.completedAtMs);
    if (timestamp) {
      return timestamp;
    }
    throw new Error(
      `Codex notification '${notification.method}' is missing its runtime lifecycle timestamp.`,
    );
  }

  const completedTurnTimestamp = timestampFromCompletedTurnNotification(notification);
  if (completedTurnTimestamp) {
    return completedTurnTimestamp;
  }

  return notification.receivedAt;
};

const isCodexIdleThreadStatus = (status: CodexAppServerThreadStatus): boolean =>
  status.type === "idle";

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

const clearTurnScopedStreamingState = (
  context: CodexStreamingContext,
  threadId: string,
  turnId: string,
): void => {
  const turnKey = codexTurnKey(threadId, turnId);
  context.completedAgentMessagesByTurnKey.delete(turnKey);
  context.tokenUsageByTurnKey.delete(turnKey);
  context.modelByTurnKey.delete(turnKey);
};

const flushBufferedFinalAgentMessage = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  turnId: string,
): void => {
  const turnKey = codexTurnKey(session.threadId, turnId);
  const bufferedAgentMessage = context.completedAgentMessagesByTurnKey.get(turnKey);
  if (!bufferedAgentMessage) {
    return;
  }
  emitFinalAgentMessage(
    context,
    bufferedAgentMessage.session,
    bufferedAgentMessage.item,
    bufferedAgentMessage.timestamp,
    context.tokenUsageByTurnKey.get(turnKey),
    bufferedAgentMessage.model ?? modelForTurn(context, session, turnId),
  );
};

const emitCodexCompletedTurnTiming = (
  context: CodexStreamingContext,
  session: CodexSessionState,
  completedAgentMessage: CompletedAgentMessage,
  turn: CodexAppServerTurn,
): void => {
  const durationMs = turn.durationMs;
  if (durationMs === null) {
    throw new Error("Completed Codex turn with a final assistant message is missing durationMs.");
  }
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error("Completed Codex turn with a final assistant message has invalid durationMs.");
  }

  const completedAtMs = Date.parse(completedAgentMessage.timestamp);
  if (Number.isNaN(completedAtMs)) {
    throw new Error("Completed Codex assistant message has an invalid timestamp.");
  }

  const activityStartedAtDate = new Date(completedAtMs - durationMs);
  if (Number.isNaN(activityStartedAtDate.getTime())) {
    throw new Error("Completed Codex turn with a final assistant message has invalid durationMs.");
  }
  const activityStartedAt = activityStartedAtDate.toISOString();
  emitCodexSessionEvent(context, session.threadId, {
    type: "session_status",
    externalSessionId: session.threadId,
    timestamp: activityStartedAt,
    status: { type: "busy", message: null },
  });
};

export const handleCodexPendingNotifications = async (
  context: CodexStreamingContext,
  session: CodexSessionState,
  notifications: CodexNotificationRecord[],
  preparedImageGeneration?: AgentImageGenerationPart,
): Promise<void> => {
  for (const notification of notifications) {
    const notificationThreadId = codexNotificationThreadId(notification);
    if (!notificationThreadId) {
      if (!isThreadScopedCodexNotificationMethod(notification.method)) {
        continue;
      }
      throw new Error(
        `Codex notification '${notification.method}' is missing params.threadId and cannot be applied to session '${session.threadId}'.`,
      );
    }
    if (notificationThreadId !== session.threadId) {
      throw new Error(
        `Codex notification '${notification.method}' belongs to thread '${notificationThreadId}', not session '${session.threadId}'.`,
      );
    }
    const timestamp = timestampFromCodexNotification(notification);
    const notificationTurnId = codexNotificationTurnId(notification);
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
      const turnId = notification.params.turn.id;
      context.startImageGenerationTurn(session, turnId, notification.receivedAt);
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
      {
        const isIdleStatus = isCodexIdleThreadStatus(notification.params.status);
        if (
          activeTurn &&
          isIdleStatus &&
          !isNotificationAtOrAfterActiveTurnStart(notification.receivedAt, activeTurn)
        ) {
          continue;
        }
        if (isIdleStatus) {
          context.settleImageGenerations(
            session,
            activeTurn?.turnId
              ? {
                  scope: "turn",
                  turnId: activeTurn.turnId,
                  reason: "turn_ended",
                  timestamp: notification.receivedAt,
                }
              : { scope: "session", reason: "turn_ended", timestamp: notification.receivedAt },
          );
          emitUnlinkedSpawnFailures(context, session, timestamp);
        }
        const liveStatus = codexThreadStatusSnapshot(notification.params.status);
        const hasBufferedFinalAgentMessage = Boolean(
          activeTurn &&
          isIdleStatus &&
          activeTurn.turnId !== undefined &&
          context.completedAgentMessagesByTurnKey.has(
            codexTurnKey(session.threadId, activeTurn.turnId),
          ),
        );
        if (!hasBufferedFinalAgentMessage) {
          context.setSessionLiveStatus(session, liveStatus);
        }
        // The held message still owes the transcript its turn-ending evidence, so keep the
        // previous status too. Turn completion applies the idle status after the flush.
        if (activeTurn && isIdleStatus) {
          if (!hasBufferedFinalAgentMessage) {
            emitCodexSessionEvent(context, session.threadId, {
              type: "session_idle",
              externalSessionId: session.threadId,
              timestamp: notification.receivedAt,
            });
          }
          activeTurn.markTurnSettled();
        }
      }
      continue;
    }

    if (notification.method === "model/safetyBuffering/updated") {
      const isActiveTurn =
        Boolean(notificationTurnId) &&
        !activeTurn?.isTurnSettled() &&
        activeTurn?.turnId === notificationTurnId;
      if (isActiveTurn) {
        emitCodexSessionEvent(context, session.threadId, {
          type: "session_status",
          externalSessionId: session.threadId,
          timestamp,
          status: {
            type: "busy",
            message: notification.params.showBufferingUi ? CODEX_SAFETY_BUFFERING_MESSAGE : null,
          },
        });
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
      {
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
        (() => {
          const mappingContext: CodexMappingContext = {
            source: "live",
            runtimeId: session.runtimeId,
            threadId: session.threadId,
            timestamp,
          };
          if (notificationTurnId) {
            mappingContext.turnId = notificationTurnId;
          }
          return mappingContext;
        })(),
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
      emitUnlinkedSpawnFailures(context, session, timestamp);
      const turn = notification.params.turn;
      const turnId = turn.id;
      context.settleImageGenerations(session, {
        scope: "turn",
        turnId,
        timestamp: notification.receivedAt,
        reason:
          turn.status === "interrupted"
            ? "interrupted"
            : turn.status === "failed"
              ? "runtime_failure"
              : "turn_ended",
      });
      if (turn.status === "completed") {
        const completedAgentMessage = context.completedAgentMessagesByTurnKey.get(
          codexTurnKey(session.threadId, turnId),
        );
        if (completedAgentMessage) {
          emitCodexCompletedTurnTiming(context, session, completedAgentMessage, turn);
        }
        flushBufferedFinalAgentMessage(context, session, turnId);
        clearTurnScopedStreamingState(context, session.threadId, turnId);
      } else {
        clearTurnScopedStreamingState(context, session.threadId, turnId);
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
          (() => {
            const mappingContext: CodexMappingContext = {
              source: "live",
              runtimeId: session.runtimeId,
              threadId: session.threadId,
              timestamp,
            };
            if (turnId) {
              mappingContext.turnId = turnId;
            }
            return mappingContext;
          })(),
        ),
      );
      continue;
    }

    if (notification.method === "item/agentMessage/delta") {
      if (notification.params.delta) {
        emitCodexSessionEvent(context, session.threadId, {
          type: "assistant_delta",
          externalSessionId: session.threadId,
          timestamp,
          channel: "text",
          messageId: notification.params.itemId,
          delta: notification.params.delta,
        });
      }
      continue;
    }

    if (
      notification.method === "item/reasoning/textDelta" ||
      notification.method === "item/reasoning/summaryTextDelta"
    ) {
      if (notification.params.delta) {
        emitCodexSessionEvent(context, session.threadId, {
          type: "assistant_delta",
          externalSessionId: session.threadId,
          timestamp,
          channel: "reasoning",
          messageId: notification.params.itemId,
          delta: notification.params.delta,
        });
      }
      continue;
    }

    if (notification.method === "item/started") {
      emitStartedItem(
        context,
        session,
        { ...notification.params.item, startedAtMs: notification.params.startedAtMs },
        timestamp,
        notification.params.turnId,
        preparedImageGeneration,
      );
      continue;
    }

    if (notification.method === "item/completed") {
      emitCompletedItem(
        context,
        session,
        { ...notification.params.item, completedAtMs: notification.params.completedAtMs },
        timestamp,
        notificationTurnId,
        preparedImageGeneration,
      );
    }
  }
};
