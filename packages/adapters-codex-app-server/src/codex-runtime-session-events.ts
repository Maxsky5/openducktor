import type {
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentUserMessagePart,
} from "@openducktor/core";
import {
  codexTurnKey,
  extractThreadIdFromParams,
  extractTurnId,
  parseNotificationRecord,
  parseServerRequestRecord,
} from "./codex-app-server-requests";
import {
  type CodexServerRequestHandlerContext,
  handleCodexServerRequest,
} from "./codex-app-server-server-requests";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import {
  type CodexStreamingContext,
  type CompletedAgentMessage,
  emitCodexUserMessage,
  handleCodexPendingNotifications,
} from "./codex-app-server-streaming";
import type { CodexThreadStatusSnapshot } from "./codex-app-server-threads";
import {
  type CodexTokenUsageTotals,
  extractCodexTokenUsageTotals,
} from "./codex-app-server-transcript";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import {
  CodexRuntimeEventBuffer,
  CodexRuntimeEventSubscriptions,
  type CodexRuntimeStreamEvent,
  threadIdFromRuntimeStreamEvent,
} from "./codex-runtime-events";
import type { CodexSessionEventBus } from "./codex-session-event-bus";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type {
  CodexAppServerAdapterOptions,
  CodexServerRequestRecord,
  CodexSessionState,
} from "./types";

type CodexRuntimeSessionEventsDeps = {
  subscribeEvents: CodexAppServerAdapterOptions["subscribeEvents"];
  drainServerRequests: CodexAppServerAdapterOptions["drainServerRequests"];
  drainNotifications: CodexAppServerAdapterOptions["drainNotifications"];
  respondServerRequest: CodexAppServerAdapterOptions["respondServerRequest"];
  sessions: CodexSessionLookup;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  sessionEvents: CodexSessionEventBus;
  pendingInput: CodexPendingInputState;
  threadInventory: Pick<
    CodexThreadInventoryReader,
    "clearReadOnlyHistoryLoad" | "clearReadOnlyHistoryLoadForNotification"
  >;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
};

type CodexRuntimeSessionHistoryContext = {
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  modelByTurnKey: ReadonlyMap<string, AgentModelSelection>;
  tokenUsageByTurnKey: ReadonlyMap<string, CodexTokenUsageTotals>;
  drainThreadReadTokenUsage: (
    runtimeId: string,
    threadId: string,
  ) => Promise<Map<string, CodexTokenUsageTotals>>;
};

export class CodexRuntimeSessionEvents {
  private readonly runtimeEventBuffer = new CodexRuntimeEventBuffer();
  private readonly handledStreamRequestKeysByThreadId = new Map<string, Set<string>>();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<string, CompletedAgentMessage>();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly modelByTurnKey = new Map<string, AgentModelSelection>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly eventMapperPipeline = createCodexEventMapperPipeline();
  private readonly runtimeEventSubscriptions: CodexRuntimeEventSubscriptions;

  constructor(private readonly deps: CodexRuntimeSessionEventsDeps) {
    this.runtimeEventSubscriptions = new CodexRuntimeEventSubscriptions(deps.subscribeEvents);
  }

  ensureRuntimeEventSubscription(runtimeId: string): void {
    this.runtimeEventSubscriptions.ensure(runtimeId, (event) => {
      void (async () => {
        try {
          await this.handleRuntimeStreamEvent(event);
        } catch (error) {
          const threadId = threadIdFromRuntimeStreamEvent(event);
          if (!threadId) {
            return;
          }
          this.emitSessionError(threadId, error);
        }
      })();
    });
  }

  stopRuntimeEventSubscription(runtimeId: string): void {
    this.runtimeEventSubscriptions.stop(runtimeId);
  }

  historyLoadContext(): CodexRuntimeSessionHistoryContext {
    return {
      eventMapperPipeline: this.eventMapperPipeline,
      modelByTurnKey: this.modelByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      drainThreadReadTokenUsage: (runtimeId: string, threadId: string) =>
        this.drainThreadReadTokenUsage(runtimeId, threadId),
    };
  }

  latestTodos(externalSessionId: string): AgentSessionTodoItem[] | undefined {
    return this.latestTodosBySessionId.get(externalSessionId);
  }

  rememberTodos(externalSessionId: string, todos: AgentSessionTodoItem[]): void {
    if (todos.length > 0) {
      this.latestTodosBySessionId.set(externalSessionId, todos);
    }
  }

  clearSession(externalSessionId: string): void {
    this.runtimeEventBuffer.clearSession(externalSessionId);
    this.handledStreamRequestKeysByThreadId.delete(externalSessionId);
    this.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
    this.latestTodosBySessionId.delete(externalSessionId);
    this.clearTurnScopedMap(this.completedAgentMessagesByTurnKey, externalSessionId);
    this.clearTurnScopedMap(this.tokenUsageByTurnKey, externalSessionId);
    this.clearTurnScopedMap(this.modelByTurnKey, externalSessionId);
  }

  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string): boolean {
    if (activeTurn.turnId && activeTurn.turnId !== turnId) {
      return false;
    }

    const didBind = !activeTurn.turnId;
    activeTurn.turnId = turnId;
    this.modelByTurnKey.set(codexTurnKey(activeTurn.session.threadId, turnId), activeTurn.model);
    return didBind;
  }

  bindPendingInputToActiveTurn(externalSessionId: string, activeTurn: ActiveCodexTurn): void {
    this.deps.pendingInput.bindActiveTurn(externalSessionId, activeTurn);
  }

  setSessionLiveStatus(session: CodexSessionState, liveStatus: CodexThreadStatusSnapshot): void {
    session.liveStatus = liveStatus;
    session.summary = {
      ...session.summary,
      status: liveStatus.agentSessionStatus,
    };
  }

  async continueTurnAfterPendingInput(activeTurn: ActiveCodexTurn): Promise<void> {
    try {
      const hasPendingInput = this.deps.subscribeEvents
        ? false
        : await this.handlePendingServerRequests(activeTurn.session, activeTurn.handledRequestKeys);
      if (hasPendingInput && !activeTurn.isTurnSettled()) {
        this.bindPendingInputToActiveTurn(activeTurn.session.threadId, activeTurn);
        return;
      }
      await activeTurn.turnStartPromise;
    } catch (error) {
      this.emitSessionError(activeTurn.session.threadId, error);
    }
  }

  async handlePendingServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
  ): Promise<boolean> {
    await this.handlePendingNotifications(session);
    const requests = await this.deps.drainServerRequests(session.runtimeId);
    const hasPendingInput = await this.handleServerRequests(session, handledRequestKeys, requests);
    return hasPendingInput || requests.length > 0;
  }

  emitUserMessage(
    session: CodexSessionState,
    parts: AgentUserMessagePart[],
    model: AgentModelSelection | undefined,
  ): void {
    emitCodexUserMessage(this.streamingContext(), session, parts, model);
  }

  async drainBufferedStreamEvents(externalSessionId: string): Promise<void> {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    await this.handlePendingNotifications(session, []);
    const bufferedRequests = this.runtimeEventBuffer.takeServerRequests(session.threadId);
    await this.processServerRequestsForSession(session, bufferedRequests);
  }

  private async handleRuntimeStreamEvent(event: CodexRuntimeStreamEvent): Promise<void> {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (event.kind === "server_request") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId);
      }
      return;
    }
    const session = this.deps.sessions.get(threadId);
    if (!session) {
      this.bufferRuntimeStreamEvent(threadId, event);
      return;
    }
    await this.processRuntimeStreamEventForSession(session, event);
  }

  private bufferRuntimeStreamEvent(
    threadId: string,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): void {
    const buffered = this.runtimeEventBuffer.bufferRuntimeStreamEvent(threadId, event);
    if (buffered.kind === "notification") {
      this.deps.threadInventory.clearReadOnlyHistoryLoadForNotification(
        threadId,
        buffered.notification,
      );
      return;
    }
    this.deps.threadInventory.clearReadOnlyHistoryLoad(threadId);
  }

  private emitUnroutableRuntimeServerRequest(runtimeId: string): void {
    for (const session of this.deps.sessions.values()) {
      if (session.runtimeId !== runtimeId) {
        continue;
      }
      this.deps.sessionEvents.emit(session.threadId, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message: "Cannot route Codex app-server request because it is missing params.threadId.",
      });
    }
  }

  private async processRuntimeStreamEventForSession(
    session: CodexSessionState,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): Promise<void> {
    if (event.kind === "notification") {
      await this.handlePendingNotifications(session, [event.message]);
      return;
    }
    await this.processServerRequestsForSession(session, [parseServerRequestRecord(event.message)]);
  }

  private async processServerRequestsForSession(
    session: CodexSessionState,
    requests: CodexServerRequestRecord[],
  ): Promise<void> {
    const activeTurn = this.deps.activeTurnsBySessionId.get(session.threadId);
    const handledRequestKeys =
      this.handledStreamRequestKeysByThreadId.get(session.threadId) ?? new Set();
    this.handledStreamRequestKeysByThreadId.set(session.threadId, handledRequestKeys);
    const hasPendingInput = await this.handleServerRequests(session, handledRequestKeys, requests);
    if (hasPendingInput && activeTurn && !activeTurn.isTurnSettled()) {
      this.bindPendingInputToActiveTurn(session.threadId, activeTurn);
    }
  }

  private async handleServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
    requests: unknown[],
  ): Promise<boolean> {
    let hasPendingInput = false;
    for (const request of requests) {
      hasPendingInput =
        (await this.handleServerRequest(
          session,
          parseServerRequestRecord(request),
          handledRequestKeys,
        )) || hasPendingInput;
    }
    return hasPendingInput;
  }

  private async handlePendingNotifications(
    session: CodexSessionState,
    notificationsFromBatch?: unknown[],
  ): Promise<void> {
    await handleCodexPendingNotifications(this.streamingContext(), session, notificationsFromBatch);
  }

  private streamingContext(): CodexStreamingContext {
    return {
      subscribeEvents: Boolean(this.deps.subscribeEvents),
      ...(this.deps.drainNotifications ? { drainNotifications: this.deps.drainNotifications } : {}),
      bufferedNotificationsByThreadId: this.runtimeEventBuffer.notificationsByThreadId,
      activeTurnsBySessionId: this.deps.activeTurnsBySessionId,
      syntheticUserMessageTextsByThreadId: this.syntheticUserMessageTextsByThreadId,
      completedAgentMessagesByTurnKey: this.completedAgentMessagesByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      modelByTurnKey: this.modelByTurnKey,
      latestTodosBySessionId: this.latestTodosBySessionId,
      eventMapperPipeline: this.eventMapperPipeline,
      emitSessionEvent: (externalSessionId, event) =>
        this.deps.sessionEvents.emit(externalSessionId, event),
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      flushQueuedUserMessagesLater: (activeTurn) =>
        this.deps.flushQueuedUserMessagesLater(activeTurn),
      bufferNotification: (notification) =>
        this.runtimeEventBuffer.bufferNotification(notification),
      setSessionLiveStatus: (session, liveStatus) => this.setSessionLiveStatus(session, liveStatus),
    };
  }

  private async handleServerRequest(
    session: CodexSessionState,
    rawRequest: CodexServerRequestRecord,
    handledRequestKeys: Set<string>,
  ): Promise<boolean> {
    return handleCodexServerRequest(
      this.serverRequestContext(),
      session,
      rawRequest,
      handledRequestKeys,
    );
  }

  private serverRequestContext(): CodexServerRequestHandlerContext {
    return {
      respondServerRequest: this.deps.respondServerRequest,
      pendingInput: this.deps.pendingInput,
      activeTurnsBySessionId: this.deps.activeTurnsBySessionId,
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      flushQueuedUserMessagesLater: (activeTurn) =>
        this.deps.flushQueuedUserMessagesLater(activeTurn),
      emitSessionEvent: (externalSessionId, event) =>
        this.deps.sessionEvents.emit(externalSessionId, event),
    };
  }

  private async drainThreadReadTokenUsage(
    runtimeId: string,
    threadId: string,
  ): Promise<Map<string, CodexTokenUsageTotals>> {
    const tokenUsageByTurnId = new Map<string, CodexTokenUsageTotals>();
    const bufferedNotifications = this.runtimeEventBuffer.takeNotifications(threadId);
    const drainedNotifications = this.deps.drainNotifications
      ? (await this.deps.drainNotifications(runtimeId)).map(parseNotificationRecord)
      : [];
    const notifications = [...bufferedNotifications, ...drainedNotifications];
    for (const notification of notifications) {
      const notificationThreadId = extractThreadIdFromParams(notification.params);
      const notificationTurnId = extractTurnId(notification.params);
      if (
        notification.method === "thread/tokenUsage/updated" &&
        notificationThreadId === threadId &&
        notificationTurnId
      ) {
        const tokenUsage = extractCodexTokenUsageTotals(notification.params);
        if (tokenUsage) {
          tokenUsageByTurnId.set(notificationTurnId, tokenUsage);
        }
        continue;
      }
      if (!this.deps.subscribeEvents) {
        this.runtimeEventBuffer.bufferNotification(notification);
      }
    }

    return tokenUsageByTurnId;
  }

  private emitSessionError(externalSessionId: string, error: unknown): void {
    this.deps.sessionEvents.emit(externalSessionId, {
      type: "session_error",
      externalSessionId,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private clearTurnScopedMap<T>(map: Map<string, T>, externalSessionId: string): void {
    const turnKeyPrefix = `${externalSessionId}:`;
    for (const turnKey of map.keys()) {
      if (turnKey.startsWith(turnKeyPrefix)) {
        map.delete(turnKey);
      }
    }
  }
}
