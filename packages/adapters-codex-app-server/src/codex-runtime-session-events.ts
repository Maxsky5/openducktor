import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentSessionRef,
  AgentSessionTodoItem,
  AgentUserMessagePart,
} from "@openducktor/core";
import { agentSessionStatusFromActivity, withAgentSessionRef } from "@openducktor/core";
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
import { type ActiveCodexTurn, isPlainObject } from "./codex-app-server-shared";
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
import { codexSessionRef } from "./codex-session-ref";
import type { CodexSubagentLinkState, CodexSubagentRoute } from "./codex-subagent-link-state";
import { createCodexEventMappers } from "./event-mappers";
import type {
  CodexAppServerAdapterOptions,
  CodexNotificationRecord,
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
  subagents: CodexSubagentLinkState;
  updateThreadStatus(runtimeId: string, threadId: string, status: CodexThreadStatusSnapshot): void;
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

type RestoredContextCapture = {
  sessionRef: AgentSessionRef;
  tokenUsageByTurnId: Map<string, CodexTokenUsageTotals>;
};

const RESTORED_USAGE_DRAIN_ATTEMPTS = 3;

const waitForRestoredUsageReplayTick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const restoredContextCaptureKey = (runtimeId: string, threadId: string): string =>
  `${runtimeId}:${threadId}`;

export class CodexRuntimeSessionEvents {
  private readonly runtimeEventBuffer = new CodexRuntimeEventBuffer();
  private readonly handledStreamRequestKeysByThreadId = new Map<string, Set<string>>();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<string, CompletedAgentMessage>();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly modelByTurnKey = new Map<string, AgentModelSelection>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly restoredContextCapturesByKey = new Map<string, RestoredContextCapture>();
  private readonly eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  private readonly runtimeEventSubscriptions: CodexRuntimeEventSubscriptions;

  constructor(private readonly deps: CodexRuntimeSessionEventsDeps) {
    this.eventMapperPipeline = createCodexEventMapperPipeline(
      createCodexEventMappers(deps.subagents),
    );
    this.runtimeEventSubscriptions = new CodexRuntimeEventSubscriptions(deps.subscribeEvents);
    deps.subagents.onRouteLearned((route) => {
      this.scheduleBufferedSubagentServerRequestDrain(route);
    });
  }

  ensureRuntimeEventSubscription(runtimeId: string): Promise<void> {
    return this.runtimeEventSubscriptions.ensure(runtimeId, (event) => {
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

  async captureRestoredContextUsage(
    sessionRef: AgentSessionRef,
    runtimeId: string,
    restore: () => Promise<void>,
  ): Promise<void> {
    const threadId = sessionRef.externalSessionId;
    const captureKey = restoredContextCaptureKey(runtimeId, threadId);
    const capture: RestoredContextCapture = {
      sessionRef,
      tokenUsageByTurnId: new Map(),
    };
    this.restoredContextCapturesByKey.set(captureKey, capture);
    try {
      await restore();
      const tokenUsageByTurnId = await this.drainThreadReadTokenUsage(runtimeId, threadId, {
        suppressTargetStatusEvents: true,
        waitForTokenUsage: true,
      });
      this.recordRestoredContextUsage(capture, threadId, tokenUsageByTurnId);
    } finally {
      this.restoredContextCapturesByKey.delete(captureKey);
    }
  }

  latestTodos(externalSessionId: string): AgentSessionTodoItem[] | undefined {
    return this.latestTodosBySessionId.get(externalSessionId);
  }

  rememberTodos(externalSessionId: string, todos: AgentSessionTodoItem[]): void {
    this.latestTodosBySessionId.set(externalSessionId, todos);
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
      status: agentSessionStatusFromActivity(liveStatus.classification),
    };
    this.deps.updateThreadStatus(session.runtimeId, session.threadId, liveStatus);
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
    event: AcceptedAgentUserMessage,
    sourceParts: AgentUserMessagePart[],
  ): AcceptedAgentUserMessage {
    return emitCodexUserMessage(this.streamingContext(), event, sourceParts);
  }

  async drainBufferedStreamEvents(externalSessionId: string): Promise<void> {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    await this.handlePendingNotifications(session, []);
    const bufferedRequests = this.runtimeEventBuffer.takeServerRequests(session.threadId);
    await this.processServerRequestsForSession(session, bufferedRequests);
    await this.drainBufferedSubagentServerRequestsForParent(session);
  }

  private scheduleBufferedSubagentServerRequestDrain(route: CodexSubagentRoute): void {
    void Promise.resolve()
      .then(() => this.drainBufferedSubagentServerRequests(route))
      .catch((error) => this.emitBufferedSubagentServerRequestError(route, error));
  }

  private async drainBufferedSubagentServerRequestsForParent(
    parentSession: CodexSessionState,
  ): Promise<void> {
    for (const route of this.deps.subagents.routesForParent(parentSession.threadId)) {
      await this.drainBufferedSubagentServerRequests(route);
    }
  }

  private async drainBufferedSubagentServerRequests(route: CodexSubagentRoute): Promise<void> {
    const parentSession = this.deps.sessions.get(route.parentExternalSessionId);
    const childSession = this.deps.sessions.get(route.childExternalSessionId);
    const session = parentSession ?? childSession;
    if (!session) {
      return;
    }

    const bufferedRequests = this.runtimeEventBuffer.takeServerRequests(
      route.childExternalSessionId,
    );
    if (bufferedRequests.length === 0) {
      return;
    }
    await this.processServerRequestsForSession(session, bufferedRequests);
  }

  private emitBufferedSubagentServerRequestError(route: CodexSubagentRoute, error: unknown): void {
    const externalSessionId = this.deps.sessions.get(route.parentExternalSessionId)
      ? route.parentExternalSessionId
      : this.deps.sessions.get(route.childExternalSessionId)
        ? route.childExternalSessionId
        : null;
    if (!externalSessionId) {
      return;
    }
    this.emitSessionError(externalSessionId, error);
  }

  private async handleRuntimeStreamEvent(event: CodexRuntimeStreamEvent): Promise<void> {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (event.kind === "server_request") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId);
      }
      return;
    }
    if (event.kind === "notification") {
      const notification = parseNotificationRecord(event.message);
      if (notification.method === "serverRequest/resolved") {
        this.handleServerRequestResolvedNotification(notification);
        return;
      }
      if (this.captureRestoredContextNotification(event.runtimeId, notification)) {
        return;
      }
    }
    const session = this.deps.sessions.get(threadId);
    if (!session) {
      if (event.kind === "server_request") {
        const route = this.deps.subagents.routeForChild(threadId);
        const parentSession = route
          ? this.deps.sessions.get(route.parentExternalSessionId)
          : undefined;
        if (parentSession) {
          await this.processRuntimeStreamEventForSession(parentSession, event);
          return;
        }
      }
      this.bufferRuntimeStreamEvent(threadId, event);
      return;
    }
    await this.processRuntimeStreamEventForSession(session, event);
  }

  private handleServerRequestResolvedNotification(notification: CodexNotificationRecord): void {
    const threadId = extractThreadIdFromParams(notification.params);
    const requestId = this.resolvedServerRequestId(notification);
    if (!threadId || !requestId) {
      throw new Error(
        "Codex serverRequest/resolved notification is missing threadId or requestId.",
      );
    }
    const approval = this.deps.pendingInput.approval(requestId);
    const question = this.deps.pendingInput.question(requestId);
    const entry = approval ?? question;
    if (!entry) {
      return;
    }
    if (entry.threadId !== threadId) {
      throw new Error(
        `Codex serverRequest/resolved request '${requestId}' belongs to session '${entry.threadId}', not '${threadId}'.`,
      );
    }
    const route = entry.route ?? this.deps.subagents.routeForChild(threadId);
    const eventBase = {
      externalSessionId: threadId,
      timestamp: new Date().toISOString(),
      requestId,
      ...(route
        ? {
            parentExternalSessionId: route.parentExternalSessionId,
            childExternalSessionId: route.childExternalSessionId,
            subagentCorrelationKey: route.subagentCorrelationKey,
          }
        : {}),
    };
    const activeTurn = approval
      ? this.deps.pendingInput.resolveApproval(requestId)
      : this.deps.pendingInput.resolveQuestion(requestId);
    const type = approval ? "approval_resolved" : "question_resolved";
    if (this.deps.sessions.get(threadId)) {
      this.emitSessionEvent(threadId, {
        ...eventBase,
        type,
      });
    }
    if (route && this.deps.sessions.get(route.parentExternalSessionId)) {
      this.emitSessionEvent(route.parentExternalSessionId, {
        ...eventBase,
        type,
        externalSessionId: route.parentExternalSessionId,
      });
    }
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.continueTurnAfterPendingInput(activeTurn);
    }
  }

  private resolvedServerRequestId(notification: CodexNotificationRecord): string | null {
    if (!isPlainObject(notification.params)) {
      return null;
    }
    const params = notification.params;
    const requestId = params.requestId ?? params.request_id;
    if (typeof requestId === "number" || typeof requestId === "string") {
      return String(requestId);
    }
    return null;
  }

  private bufferRuntimeStreamEvent(
    threadId: string,
    event: { kind: "notification" | "server_request"; message: unknown },
  ): void {
    this.runtimeEventBuffer.bufferRuntimeStreamEvent(threadId, event);
  }

  private emitUnroutableRuntimeServerRequest(runtimeId: string): void {
    for (const session of this.deps.sessions.values()) {
      if (session.runtimeId !== runtimeId) {
        continue;
      }
      this.emitSessionEventForSession(session, {
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
      await this.handlePendingNotifications(session, [parseNotificationRecord(event.message)]);
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
    notificationsFromBatch?: CodexNotificationRecord[],
  ): Promise<void> {
    const notifications = notificationsFromBatch
      ? this.captureRestoredContextNotifications(session, notificationsFromBatch)
      : notificationsFromBatch;
    await handleCodexPendingNotifications(this.streamingContext(), session, notifications);
  }

  private captureRestoredContextNotifications(
    session: CodexSessionState,
    notifications: CodexNotificationRecord[],
  ): CodexNotificationRecord[] {
    if (
      !this.restoredContextCapturesByKey.has(
        restoredContextCaptureKey(session.runtimeId, session.threadId),
      )
    ) {
      return notifications;
    }

    const remaining: CodexNotificationRecord[] = [];
    for (const notification of notifications) {
      if (this.captureRestoredContextNotification(session.runtimeId, notification)) {
        continue;
      }
      remaining.push(notification);
    }
    return remaining;
  }

  private captureRestoredContextNotification(
    runtimeId: string,
    notification: CodexNotificationRecord,
  ): boolean {
    const threadId = extractThreadIdFromParams(notification.params);
    if (!threadId) {
      return false;
    }
    const capture = this.restoredContextCapturesByKey.get(
      restoredContextCaptureKey(runtimeId, threadId),
    );
    if (!capture) {
      return false;
    }
    if (notification.method === "thread/status/changed") {
      return true;
    }
    if (notification.method !== "thread/tokenUsage/updated") {
      return false;
    }
    const turnId = extractTurnId(notification.params);
    const tokenUsage = extractCodexTokenUsageTotals(notification.params);
    if (turnId && tokenUsage) {
      this.recordRestoredContextUsage(capture, threadId, new Map([[turnId, tokenUsage]]));
    }
    return true;
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
        this.emitSessionEvent(externalSessionId, event),
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
      subagents: this.deps.subagents,
      sessionForThreadId: (threadId) => this.deps.sessions.get(threadId),
      bindActiveTurnId: (activeTurn, turnId) => this.bindActiveTurnId(activeTurn, turnId),
      flushQueuedUserMessagesLater: (activeTurn) =>
        this.deps.flushQueuedUserMessagesLater(activeTurn),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    };
  }

  private async drainThreadReadTokenUsage(
    runtimeId: string,
    threadId: string,
    options: { suppressTargetStatusEvents?: boolean; waitForTokenUsage?: boolean } = {},
  ): Promise<Map<string, CodexTokenUsageTotals>> {
    const tokenUsageByTurnId = new Map<string, CodexTokenUsageTotals>();

    const drainOnce = async (): Promise<void> => {
      const bufferedNotifications = this.runtimeEventBuffer.takeNotifications(threadId);
      const drainedNotifications = this.deps.drainNotifications
        ? (await this.deps.drainNotifications(runtimeId)).map((notification) =>
            parseNotificationRecord(notification),
          )
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
            this.tokenUsageByTurnKey.set(codexTurnKey(threadId, notificationTurnId), tokenUsage);
          }
          continue;
        }
        if (
          options.suppressTargetStatusEvents &&
          notification.method === "thread/status/changed" &&
          notificationThreadId === threadId
        ) {
          continue;
        }
        if (!this.deps.subscribeEvents) {
          this.runtimeEventBuffer.bufferNotification(notification);
        }
      }
    };

    await drainOnce();
    for (
      let attempt = 1;
      options.waitForTokenUsage &&
      tokenUsageByTurnId.size === 0 &&
      attempt < RESTORED_USAGE_DRAIN_ATTEMPTS;
      attempt += 1
    ) {
      await waitForRestoredUsageReplayTick();
      await drainOnce();
    }

    return tokenUsageByTurnId;
  }

  private recordRestoredContextUsage(
    capture: RestoredContextCapture,
    threadId: string,
    tokenUsageByTurnId: ReadonlyMap<string, CodexTokenUsageTotals>,
  ): void {
    for (const [turnId, tokenUsage] of tokenUsageByTurnId) {
      capture.tokenUsageByTurnId.set(turnId, tokenUsage);
      this.tokenUsageByTurnKey.set(codexTurnKey(threadId, turnId), tokenUsage);
    }
    this.emitLatestContextUsage(capture.sessionRef, capture.tokenUsageByTurnId);
  }

  private emitLatestContextUsage(
    sessionRef: AgentSessionRef,
    tokenUsageByTurnId: ReadonlyMap<string, CodexTokenUsageTotals>,
  ): void {
    let latestTokenUsage: CodexTokenUsageTotals | null = null;
    for (const tokenUsage of tokenUsageByTurnId.values()) {
      latestTokenUsage = tokenUsage;
    }
    if (!latestTokenUsage) {
      return;
    }
    this.deps.sessionEvents.emit(
      sessionRef,
      withAgentSessionRef(sessionRef, {
        type: "session_context_updated",
        externalSessionId: sessionRef.externalSessionId,
        timestamp: new Date().toISOString(),
        totalTokens: latestTokenUsage.totalTokens,
        ...(typeof latestTokenUsage.contextWindow === "number"
          ? { contextWindow: latestTokenUsage.contextWindow }
          : {}),
      }),
    );
  }

  private emitSessionError(externalSessionId: string, error: unknown): void {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    this.emitSessionEventForSession(session, {
      type: "session_error",
      externalSessionId,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private emitSessionEvent(externalSessionId: string, event: AgentEvent): void {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      throw new Error(
        `Cannot emit Codex session event for missing session '${externalSessionId}'.`,
      );
    }
    this.emitSessionEventForSession(session, event);
  }

  private emitSessionEventForSession(session: CodexSessionState, event: AgentEvent): void {
    const sessionRef = codexSessionRef(session);
    this.deps.sessionEvents.emit(sessionRef, withAgentSessionRef(sessionRef, event));
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
