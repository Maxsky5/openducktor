import {
  type AgentSessionLiveRef,
  type AgentSessionTranscriptEvent,
  type CodexAppServerRequestId,
  isAgentSessionTranscriptEventType,
} from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentUserMessagePart,
} from "@openducktor/core";
import { agentSessionStatusFromActivity, withAgentSessionRef } from "@openducktor/core";
import { codexServerRequestKey } from "./codex-app-server-approvals";
import {
  codexTurnKey,
  extractThreadIdFromParams,
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
import type { CodexTokenUsageTotals } from "./codex-app-server-transcript";
import { CodexContextUsageTracker } from "./codex-context-usage-tracker";

import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import {
  CodexRuntimeEventSubscriptions,
  type CodexRuntimeStreamEvent,
  threadIdFromRuntimeStreamEvent,
} from "./codex-runtime-events";
import type { CodexSessionEventBus } from "./codex-session-event-bus";
import { codexSessionRef } from "./codex-session-ref";
import { CodexSubagentLifecycleProjector } from "./codex-subagent-lifecycle-projector";
import {
  type CodexSubagentLinkState,
  type CodexSubagentRoute,
  codexSubagentRouteEventFields,
} from "./codex-subagent-link-state";
import { createCodexEventMappers } from "./event-mappers";
import type {
  CodexAppServerAdapterOptions,
  CodexAppServerEventSubscriber,
  CodexNotificationRecord,
  CodexRuntimeEventQueueFailureHandler,
  CodexServerRequestRecord,
  CodexSessionContextUsage,
  CodexSessionState,
} from "./types";

type CodexRuntimeSessionEventsDepsBase = {
  respondServerRequest: CodexAppServerAdapterOptions["respondServerRequest"];
  onLiveSessionMutation?: (mutation: CodexRuntimeLiveSessionMutation) => void | Promise<void>;
  onCatalogInvalidated?: CodexAppServerAdapterOptions["onCatalogInvalidated"];
  sessions: CodexSessionLookup;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  sessionEvents: CodexSessionEventBus;
  pendingInput: CodexPendingInputState;
  subagents: CodexSubagentLinkState;
  updateThreadStatus(runtimeId: string, threadId: string, status: CodexThreadStatusSnapshot): void;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
};

type CodexRuntimeSessionEventsStreamingDeps = CodexRuntimeSessionEventsDepsBase & {
  subscribeEvents: CodexAppServerEventSubscriber;
  onRuntimeEventQueueFailure: CodexRuntimeEventQueueFailureHandler;
};

type CodexRuntimeSessionEventsRequestOnlyDeps = CodexRuntimeSessionEventsDepsBase & {
  subscribeEvents?: undefined;
  onRuntimeEventQueueFailure?: never;
};

type CodexRuntimeSessionEventsDeps =
  | CodexRuntimeSessionEventsStreamingDeps
  | CodexRuntimeSessionEventsRequestOnlyDeps;

type CodexServerRequestEnvelope = {
  request: CodexServerRequestRecord;
  receivedAt: string;
};

type CodexRuntimeStreamEventSessionOwner = {
  faultSession: CodexSessionState;
};

export type CodexRuntimeLiveSessionMutation = {
  runtimeId: string;
  transcriptEvents: AgentSessionTranscriptEvent[];
  catalogInvalidated: boolean;
  fault?: string;
  faultRef?: AgentSessionLiveRef;
};

const receivedAtMsFromRuntimeStreamEvent = (receivedAt: string): number => {
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    throw new Error(
      `Codex app-server stream event has an unparsable receivedAt timestamp '${receivedAt}'.`,
    );
  }
  return receivedAtMs;
};

const serverRequestFromRuntimeEvent = (
  event: Pick<CodexRuntimeStreamEvent, "message" | "receivedAt">,
): CodexServerRequestEnvelope => ({
  request: parseServerRequestRecord(event.message),
  receivedAt: event.receivedAt,
});

const routedChildSession = (
  parentSession: CodexSessionState,
  route: CodexSubagentRoute,
): CodexSessionState => ({
  ...parentSession,
  summary: {
    ...parentSession.summary,
    externalSessionId: route.childExternalSessionId,
    title: route.childExternalSessionId,
  },
  threadId: route.childExternalSessionId,
});

export class CodexRuntimeSessionEvents {
  private readonly handledStreamRequestKeysByRuntimeId = new Map<
    string,
    Map<string, Set<string>>
  >();
  private readonly syntheticUserMessageTextsByThreadId = new Map<string, string[]>();
  private readonly completedAgentMessagesByTurnKey = new Map<string, CompletedAgentMessage>();
  private readonly tokenUsageByTurnKey = new Map<string, CodexTokenUsageTotals>();
  private readonly modelByTurnKey = new Map<string, AgentModelSelection>();
  private readonly startedItemTimestampsByKey = new Map<string, number>();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly runtimeEventProcessingByRuntimeId = new Map<string, Promise<void>>();
  private readonly activeMutationByRuntimeId = new Map<string, CodexRuntimeLiveSessionMutation>();
  private readonly eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  private readonly runtimeEventSubscriptions: CodexRuntimeEventSubscriptions;
  private readonly subagentLifecycle: CodexSubagentLifecycleProjector;
  private readonly contextUsage: CodexContextUsageTracker;

  constructor(private readonly deps: CodexRuntimeSessionEventsDeps) {
    this.eventMapperPipeline = createCodexEventMapperPipeline(
      createCodexEventMappers(deps.subagents),
    );
    this.runtimeEventSubscriptions = new CodexRuntimeEventSubscriptions(deps.subscribeEvents);
    this.contextUsage = new CodexContextUsageTracker();
    this.subagentLifecycle = new CodexSubagentLifecycleProjector({
      sessions: deps.sessions,
      subagents: deps.subagents,
      emitParentSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    });
    deps.subagents.onRouteLearned((route) => {
      this.applyLearnedSubagentRoute(route);
    });
  }

  ensureRuntimeEventSubscription(runtimeId: string): Promise<void> {
    const { subscribeEvents, onRuntimeEventQueueFailure } = this.deps;
    if (!subscribeEvents) {
      throw new Error(
        `Cannot observe Codex runtime '${runtimeId}' because live event subscription is unavailable.`,
      );
    }
    return this.runtimeEventSubscriptions.ensure(runtimeId, (event) => {
      this.enqueueRuntimeStreamEvent(event, onRuntimeEventQueueFailure);
    });
  }

  stopRuntimeEventSubscription(runtimeId: string): void {
    try {
      this.runtimeEventSubscriptions.stop(runtimeId);
    } finally {
      this.contextUsage.clearRuntime(runtimeId);
    }
  }

  clearRuntime(runtimeId: string): void {
    try {
      this.stopRuntimeEventSubscription(runtimeId);
    } finally {
      this.subagentLifecycle.clearRuntime(runtimeId);
      this.handledStreamRequestKeysByRuntimeId.delete(runtimeId);
      this.activeMutationByRuntimeId.delete(runtimeId);
    }
  }

  forgetHandledServerRequest(
    runtimeId: string,
    threadId: string,
    requestId: CodexAppServerRequestId,
  ): void {
    const handledRequestKeysByThreadId = this.handledStreamRequestKeysByRuntimeId.get(runtimeId);
    const handledRequestKeys = handledRequestKeysByThreadId?.get(threadId);
    handledRequestKeys?.delete(codexServerRequestKey(requestId));
    if (handledRequestKeys?.size === 0) {
      handledRequestKeysByThreadId?.delete(threadId);
    }
    if (handledRequestKeysByThreadId?.size === 0) {
      this.handledStreamRequestKeysByRuntimeId.delete(runtimeId);
    }
  }

  latestContextUsage(runtimeId: string, threadId: string): CodexSessionContextUsage | null {
    return this.contextUsage.latest(runtimeId, threadId);
  }

  loadSessionContextUsage(
    runtimeId: string,
    threadId: string,
    resumeWithTurns: () => Promise<void>,
  ): Promise<CodexSessionContextUsage | null> {
    return this.contextUsage.load(runtimeId, threadId, resumeWithTurns);
  }

  private enqueueRuntimeStreamEvent(
    event: CodexRuntimeStreamEvent,
    onRuntimeEventQueueFailure: CodexRuntimeEventQueueFailureHandler,
  ): void {
    const previous =
      this.runtimeEventProcessingByRuntimeId.get(event.runtimeId) ?? Promise.resolve();
    const processing = previous
      .then(() => this.processRuntimeStreamEventMutation(event))
      .catch((error) => onRuntimeEventQueueFailure({ runtimeId: event.runtimeId, error }));
    this.runtimeEventProcessingByRuntimeId.set(event.runtimeId, processing);
    void processing.finally(() => {
      if (this.runtimeEventProcessingByRuntimeId.get(event.runtimeId) === processing) {
        this.runtimeEventProcessingByRuntimeId.delete(event.runtimeId);
      }
    });
  }

  private async processRuntimeStreamEventMutation(event: CodexRuntimeStreamEvent): Promise<void> {
    const mutation: CodexRuntimeLiveSessionMutation = {
      runtimeId: event.runtimeId,
      transcriptEvents: [],
      catalogInvalidated: false,
    };
    this.activeMutationByRuntimeId.set(event.runtimeId, mutation);
    try {
      try {
        await this.handleRuntimeStreamEvent(event);
      } catch (error) {
        const owner = this.runtimeStreamEventSessionOwner(event);
        Object.assign(mutation, {
          fault: this.errorMessage(error),
          ...(owner ? { faultRef: codexSessionRef(owner.faultSession) } : {}),
        });
        this.emitRuntimeStreamEventError(event, error);
      }
      if (mutation.catalogInvalidated) {
        await this.deps.onCatalogInvalidated?.({ runtimeId: event.runtimeId, catalog: "skills" });
      }
      await this.deps.onLiveSessionMutation?.(mutation);
    } finally {
      if (this.activeMutationByRuntimeId.get(event.runtimeId) === mutation) {
        this.activeMutationByRuntimeId.delete(event.runtimeId);
      }
    }
  }

  latestTodos(externalSessionId: string): AgentSessionTodoItem[] | undefined {
    return this.latestTodosBySessionId.get(externalSessionId);
  }

  rememberTodos(externalSessionId: string, todos: AgentSessionTodoItem[]): void {
    this.latestTodosBySessionId.set(externalSessionId, todos);
  }

  clearSession(externalSessionId: string, runtimeId?: string): void {
    this.subagentLifecycle.clearSession(externalSessionId, runtimeId);
    this.clearHandledStreamRequestKeys(externalSessionId, runtimeId);
    this.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
    this.latestTodosBySessionId.delete(externalSessionId);
    this.contextUsage.clearSession(externalSessionId, runtimeId);
    this.clearTurnScopedMap(this.completedAgentMessagesByTurnKey, externalSessionId);
    this.clearTurnScopedMap(this.tokenUsageByTurnKey, externalSessionId);
    this.clearTurnScopedMap(this.modelByTurnKey, externalSessionId);
  }

  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): boolean {
    if (activeTurn.turnId && activeTurn.turnId !== turnId) {
      return false;
    }

    if (startedAtMs !== undefined && !Number.isFinite(startedAtMs)) {
      throw new Error("Codex active turn was bound with an invalid start timestamp.");
    }

    const didBind = !activeTurn.turnId;
    if (didBind) {
      const turnStartRequestSentAtMs = activeTurn.turnStartRequestSentAtMs;
      if (turnStartRequestSentAtMs === null) {
        return false;
      }
      if (startedAtMs !== undefined && startedAtMs < turnStartRequestSentAtMs) {
        return false;
      }
    }

    activeTurn.turnId = turnId;
    if (startedAtMs !== undefined && (didBind || startedAtMs < activeTurn.startedAtMs)) {
      activeTurn.startedAtMs = startedAtMs;
    } else if (didBind) {
      activeTurn.startedAtMs = Date.now();
    }
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
      await activeTurn.turnStartPromise;
    } catch (error) {
      this.emitSessionError(activeTurn.session.threadId, error);
    }
  }

  emitUserMessage(
    event: AcceptedAgentUserMessage,
    sourceParts: AgentUserMessagePart[],
  ): AcceptedAgentUserMessage {
    return emitCodexUserMessage(this.streamingContext(), event, sourceParts);
  }

  private applyLearnedSubagentRoute(route: CodexSubagentRoute): void {
    try {
      this.applyRouteToPendingInput(route);
      this.subagentLifecycle.projectBufferedRoute(route);
    } catch (error) {
      this.emitSubagentRouteError(route, error);
    }
  }

  private applyRouteToPendingInput(route: CodexSubagentRoute): void {
    const parentSession = this.deps.sessions.get(route.parentExternalSessionId);
    if (route.runtimeId && parentSession && parentSession.runtimeId !== route.runtimeId) {
      this.emitCrossRuntimeRouteError(
        route.runtimeId,
        route.childExternalSessionId,
        parentSession.runtimeId,
        parentSession.threadId,
      );
      return;
    }
    const routed = this.deps.pendingInput.applyRouteToPendingInput(route);
    const activeTurn = this.deps.activeTurnsBySessionId.get(route.parentExternalSessionId);
    if (activeTurn && !activeTurn.isTurnSettled()) {
      this.deps.pendingInput.bindActiveTurn(route.parentExternalSessionId, activeTurn);
    }

    if (!parentSession) {
      return;
    }

    for (const entry of routed.approvals) {
      this.emitSessionEvent(route.parentExternalSessionId, {
        ...entry.request,
        type: "approval_required",
        externalSessionId: route.parentExternalSessionId,
        timestamp: new Date().toISOString(),
        ...codexSubagentRouteEventFields(route),
      });
    }

    for (const entry of routed.questions) {
      this.emitSessionEvent(route.parentExternalSessionId, {
        ...entry.request,
        type: "question_required",
        externalSessionId: route.parentExternalSessionId,
        timestamp: new Date().toISOString(),
        ...codexSubagentRouteEventFields(route),
      });
    }
  }

  private emitSubagentRouteError(route: CodexSubagentRoute, error: unknown): void {
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
    this.assertRuntimeStreamEventReceivedAt(event);
    if (event.kind === "notification") {
      this.observeCatalogInvalidation(event.runtimeId, event.message);
    }
    const notification =
      event.kind === "notification"
        ? parseNotificationRecord(event.message, event.receivedAt)
        : null;
    if (notification?.method === "thread/tokenUsage/updated") {
      this.contextUsage.observeNotification(event.runtimeId, notification);
    }
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (event.kind === "server_request") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId);
      }
      return;
    }
    if (notification?.method === "serverRequest/resolved") {
      this.handleServerRequestResolvedNotification(event.runtimeId, notification);
      return;
    }
    const session = this.deps.sessions.get(threadId);
    if (!session) {
      const route = this.deps.subagents.routeForChild(threadId, event.runtimeId);
      const parentSession = route
        ? this.deps.sessions.get(route.parentExternalSessionId)
        : undefined;
      if (event.kind === "server_request") {
        if (route?.runtimeId && route.runtimeId !== event.runtimeId) {
          throw new Error(
            `Cannot route Codex server request for thread '${threadId}' from runtime '${event.runtimeId}' because its subagent route belongs to runtime '${route.runtimeId}'.`,
          );
        }
        if (parentSession) {
          if (parentSession.runtimeId !== event.runtimeId) {
            throw new Error(
              `Cannot route Codex server request for thread '${threadId}' from runtime '${event.runtimeId}' because parent '${parentSession.threadId}' belongs to runtime '${parentSession.runtimeId}'.`,
            );
          }
          await this.processRuntimeStreamEventForSession(parentSession, event);
          return;
        }
        throw new Error(
          `Cannot route Codex server request for thread '${threadId}' because no retained session or subagent route exists.`,
        );
      }
      if (notification) {
        this.subagentLifecycle.projectNotification(event.runtimeId, notification);
      }
      if (route && parentSession) {
        if (parentSession.runtimeId !== event.runtimeId) {
          throw new Error(
            `Cannot route Codex notification for thread '${threadId}' from runtime '${event.runtimeId}' because parent '${parentSession.threadId}' belongs to runtime '${parentSession.runtimeId}'.`,
          );
        }
        await this.processRuntimeStreamEventForSession(
          routedChildSession(parentSession, route),
          event,
        );
      }
      return;
    }
    if (session.runtimeId !== event.runtimeId) {
      if (event.kind === "server_request") {
        throw new Error(
          `Cannot route Codex server request for thread '${threadId}' from runtime '${event.runtimeId}' because the session belongs to runtime '${session.runtimeId}'.`,
        );
      }
      return;
    }
    if (notification) {
      this.subagentLifecycle.projectNotification(event.runtimeId, notification);
    }
    await this.processRuntimeStreamEventForSession(session, event);
  }

  private handleServerRequestResolvedNotification(
    runtimeId: string,
    notification: CodexNotificationRecord,
  ): void {
    const threadId = extractThreadIdFromParams(notification.params);
    const requestId = this.resolvedServerRequestId(notification);
    if (!threadId || requestId === null) {
      throw new Error(
        "Codex serverRequest/resolved notification is missing threadId or requestId.",
      );
    }
    this.resolvePendingServerRequest(threadId, requestId, runtimeId);
  }

  private resolvePendingServerRequest(
    threadId: string,
    requestId: CodexAppServerRequestId,
    runtimeId?: string,
  ): boolean {
    if (!runtimeId) {
      return false;
    }
    const pending = this.deps.pendingInput.nativeRequest(runtimeId, threadId, requestId);
    if (!pending) {
      return false;
    }
    const { entry } = pending;
    const route = entry.route ?? this.deps.subagents.routeForChild(threadId, entry.runtimeId);
    const eventBase = {
      externalSessionId: threadId,
      timestamp: new Date().toISOString(),
      requestId: entry.request.requestId,
      ...(entry.request.requestInstanceId
        ? { requestInstanceId: entry.request.requestInstanceId }
        : {}),
      ...codexSubagentRouteEventFields(route),
    };
    const activeTurn =
      pending.kind === "approval"
        ? this.deps.pendingInput.resolveApproval(entry.request.requestId, entry.runtimeId)
        : this.deps.pendingInput.resolveQuestion(entry.request.requestId, entry.runtimeId);
    const type = pending.kind === "approval" ? "approval_resolved" : "question_resolved";
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
    this.forgetHandledServerRequest(entry.runtimeId, entry.threadId, requestId);
    return true;
  }

  private resolvedServerRequestId(
    notification: CodexNotificationRecord,
  ): CodexAppServerRequestId | null {
    if (!isPlainObject(notification.params)) {
      return null;
    }
    const params = notification.params;
    const requestId = params.requestId ?? params.request_id;
    if (typeof requestId === "number" || typeof requestId === "string") {
      return requestId;
    }
    return null;
  }

  private emitRuntimeStreamEventError(event: CodexRuntimeStreamEvent, error: unknown): void {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (event.kind === "server_request") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId, this.errorMessage(error));
      }
      return;
    }
    const owner = this.runtimeStreamEventSessionOwner(event);
    if (owner) {
      this.emitSessionErrorForSession(owner.faultSession, error);
    }
  }

  private runtimeStreamEventSessionOwner(
    event: CodexRuntimeStreamEvent,
  ): CodexRuntimeStreamEventSessionOwner | undefined {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      return undefined;
    }
    const session = this.deps.sessions.get(threadId);
    if (session?.runtimeId === event.runtimeId) {
      return { faultSession: session };
    }
    const route = this.deps.subagents.routeForChild(threadId, event.runtimeId);
    const parentSession = route ? this.deps.sessions.get(route.parentExternalSessionId) : undefined;
    if (!route || parentSession?.runtimeId !== event.runtimeId) {
      return undefined;
    }
    return {
      faultSession: routedChildSession(parentSession, route),
    };
  }

  private emitCrossRuntimeRouteError(
    runtimeId: string,
    threadId: string,
    ownerRuntimeId: string,
    targetExternalSessionId?: string,
  ): void {
    if (!targetExternalSessionId) {
      return;
    }
    this.emitSessionError(
      targetExternalSessionId,
      `Cannot route Codex server request for thread '${threadId}' because the known session or subagent route belongs to runtime '${ownerRuntimeId}', not '${runtimeId}'.`,
    );
  }

  private emitUnroutableRuntimeServerRequest(
    runtimeId: string,
    message = "Cannot route Codex app-server request because it is missing a thread identifier.",
  ): void {
    for (const session of this.deps.sessions.values()) {
      if (session.runtimeId !== runtimeId) {
        continue;
      }
      this.emitSessionEventForSession(session, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message,
      });
    }
  }

  private async processRuntimeStreamEventForSession(
    session: CodexSessionState,
    event: Pick<CodexRuntimeStreamEvent, "kind" | "receivedAt" | "message">,
  ): Promise<void> {
    if (event.kind === "notification") {
      await this.handlePendingNotifications(session, [
        parseNotificationRecord(event.message, event.receivedAt),
      ]);
      return;
    }
    await this.processServerRequestsForSession(session, [serverRequestFromRuntimeEvent(event)]);
  }

  private async processServerRequestsForSession(
    session: CodexSessionState,
    requests: CodexServerRequestEnvelope[],
    handledRequestKeysOverride?: Set<string>,
  ): Promise<boolean> {
    const activeTurn = this.deps.activeTurnsBySessionId.get(session.threadId);
    let hasPendingInput = false;
    const requestsByOwnerThreadId = new Map<string, CodexServerRequestEnvelope[]>();
    for (const request of requests) {
      const ownerThreadId = extractThreadIdFromParams(request.request.params) ?? session.threadId;
      const ownerRequests = requestsByOwnerThreadId.get(ownerThreadId) ?? [];
      ownerRequests.push(request);
      requestsByOwnerThreadId.set(ownerThreadId, ownerRequests);
    }
    for (const [ownerThreadId, ownerRequests] of requestsByOwnerThreadId) {
      const handledRequestKeysByThreadId =
        this.handledStreamRequestKeysByRuntimeId.get(session.runtimeId) ?? new Map();
      const existingHandledRequestKeys = handledRequestKeysByThreadId.get(ownerThreadId);
      const handledRequestKeys =
        existingHandledRequestKeys ??
        (ownerThreadId === session.threadId
          ? (handledRequestKeysOverride ?? activeTurn?.handledRequestKeys)
          : undefined) ??
        new Set<string>();
      handledRequestKeysByThreadId.set(ownerThreadId, handledRequestKeys);
      this.handledStreamRequestKeysByRuntimeId.set(session.runtimeId, handledRequestKeysByThreadId);
      hasPendingInput =
        (await this.handleServerRequests(session, handledRequestKeys, ownerRequests)) ||
        hasPendingInput;
    }
    if (hasPendingInput && activeTurn && !activeTurn.isTurnSettled()) {
      this.bindPendingInputToActiveTurn(session.threadId, activeTurn);
    }
    return hasPendingInput;
  }

  private clearHandledStreamRequestKeys(externalSessionId: string, runtimeId?: string): void {
    const runtimeIds = runtimeId
      ? [runtimeId]
      : [...this.handledStreamRequestKeysByRuntimeId.keys()];
    for (const currentRuntimeId of runtimeIds) {
      const handledRequestKeysByThreadId =
        this.handledStreamRequestKeysByRuntimeId.get(currentRuntimeId);
      handledRequestKeysByThreadId?.delete(externalSessionId);
      if (handledRequestKeysByThreadId?.size === 0) {
        this.handledStreamRequestKeysByRuntimeId.delete(currentRuntimeId);
      }
    }
  }

  private observeCatalogInvalidation(runtimeId: string, message: unknown): void {
    if (!isPlainObject(message) || message.method !== "skills/changed") {
      return;
    }
    const mutation = this.activeMutationByRuntimeId.get(runtimeId);
    if (mutation) {
      mutation.catalogInvalidated = true;
    }
  }

  private async handleServerRequests(
    session: CodexSessionState,
    handledRequestKeys: Set<string>,
    requests: CodexServerRequestEnvelope[],
  ): Promise<boolean> {
    let hasPendingInput = false;
    for (const { request, receivedAt } of requests) {
      hasPendingInput =
        (await this.handleServerRequest(
          session,
          request,
          handledRequestKeys,
          receivedAtMsFromRuntimeStreamEvent(receivedAt),
        )) || hasPendingInput;
    }
    return hasPendingInput;
  }

  private async handlePendingNotifications(
    session: CodexSessionState,
    notifications: CodexNotificationRecord[],
  ): Promise<void> {
    await handleCodexPendingNotifications(this.streamingContext(session), session, notifications);
  }

  private streamingContext(scopedSession?: CodexSessionState): CodexStreamingContext {
    return {
      activeTurnsBySessionId: this.deps.activeTurnsBySessionId,
      startedItemTimestampsByKey: this.startedItemTimestampsByKey,
      syntheticUserMessageTextsByThreadId: this.syntheticUserMessageTextsByThreadId,
      completedAgentMessagesByTurnKey: this.completedAgentMessagesByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      modelByTurnKey: this.modelByTurnKey,
      latestTodosBySessionId: this.latestTodosBySessionId,
      eventMapperPipeline: this.eventMapperPipeline,
      emitSessionEvent: (externalSessionId, event) => {
        if (scopedSession?.threadId === externalSessionId) {
          this.emitSessionEventForSession(scopedSession, event);
          return;
        }
        this.emitSessionEvent(externalSessionId, event);
      },
      bindActiveTurnId: (activeTurn, turnId, startedAtMs) =>
        this.bindActiveTurnId(activeTurn, turnId, startedAtMs),
      flushQueuedUserMessagesLater: (activeTurn) =>
        this.deps.flushQueuedUserMessagesLater(activeTurn),
      setSessionLiveStatus: (session, liveStatus) => this.setSessionLiveStatus(session, liveStatus),
      failUnlinkedSubagentSpawns: (parentThreadId, runtimeId, error) =>
        this.deps.subagents.failUnlinkedSpawnsForParent(parentThreadId, runtimeId, error),
    };
  }

  private async handleServerRequest(
    session: CodexSessionState,
    rawRequest: CodexServerRequestRecord,
    handledRequestKeys: Set<string>,
    requestReceivedAtMs?: number,
  ): Promise<boolean> {
    return handleCodexServerRequest(
      this.serverRequestContext(),
      session,
      rawRequest,
      handledRequestKeys,
      requestReceivedAtMs,
    );
  }

  private serverRequestContext(): CodexServerRequestHandlerContext {
    const respondServerRequest = this.deps.respondServerRequest;
    if (!respondServerRequest) {
      throw new Error(
        "Cannot handle Codex live input because server-request replies are unavailable.",
      );
    }
    return {
      respondServerRequest,
      pendingInput: this.deps.pendingInput,
      activeTurnsBySessionId: this.deps.activeTurnsBySessionId,
      subagents: this.deps.subagents,
      sessionForThreadId: (threadId) => this.deps.sessions.get(threadId),
      bindActiveTurnId: (activeTurn, turnId, startedAtMs) =>
        this.bindActiveTurnId(activeTurn, turnId, startedAtMs),
      flushQueuedUserMessagesLater: (activeTurn) =>
        this.deps.flushQueuedUserMessagesLater(activeTurn),
      emitSessionEvent: (externalSessionId, event) =>
        this.emitSessionEvent(externalSessionId, event),
    };
  }

  private emitSessionError(externalSessionId: string, error: unknown): void {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    this.emitSessionErrorForSession(session, error);
  }

  private emitSessionErrorForSession(session: CodexSessionState, error: unknown): void {
    this.emitSessionEventForSession(session, {
      type: "session_error",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      message: this.errorMessage(error),
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private assertRuntimeStreamEventReceivedAt(
    event: Pick<CodexRuntimeStreamEvent, "receivedAt">,
  ): void {
    const receivedAt = (event as { receivedAt?: unknown }).receivedAt;
    if (typeof receivedAt !== "string" || receivedAt.trim().length === 0) {
      throw new Error("Codex app-server stream event is missing receivedAt.");
    }
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
    const normalizedEvent = withAgentSessionRef(sessionRef, event);
    this.deps.sessionEvents.emit(sessionRef, normalizedEvent);
    if (isAgentSessionTranscriptEventType(normalizedEvent.type)) {
      this.activeMutationByRuntimeId
        .get(session.runtimeId)
        ?.transcriptEvents.push(normalizedEvent as AgentSessionTranscriptEvent);
    }
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
