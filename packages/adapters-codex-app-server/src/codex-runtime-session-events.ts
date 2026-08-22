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
import { codexTurnKey, extractThreadIdFromParams } from "./codex-app-server-requests";
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
import type { CodexRuntimeNotification } from "./codex-runtime-event-schema";
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
  retainedSession: CodexSessionState;
  targetSession: CodexSessionState;
};

type CodexRuntimeStreamEventSessionOwner = {
  retainedSession: CodexSessionState;
  targetSession: CodexSessionState;
};

type CodexThreadDiffState = {
  latestTurnId: string;
  byTurnId: Map<string, string>;
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
  event: Extract<CodexRuntimeStreamEvent, { kind: "server_request" }>,
  retainedSession: CodexSessionState,
  targetSession: CodexSessionState,
): CodexServerRequestEnvelope => ({
  request: event.message,
  receivedAt: event.receivedAt,
  retainedSession,
  targetSession,
});

const isServerRequestStreamEvent = (event: CodexRuntimeStreamEvent): boolean =>
  event.kind === "server_request" ||
  (event.kind === "fault" && event.sourceKind === "server_request");

const routedSession = (
  retainedSession: CodexSessionState,
  targetExternalSessionId: string,
): CodexSessionState => ({
  ...retainedSession,
  summary: {
    ...retainedSession.summary,
    externalSessionId: targetExternalSessionId,
    title: targetExternalSessionId,
  },
  threadId: targetExternalSessionId,
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
  private readonly startedItemTimestampsByRuntimeId = new Map<
    string,
    Map<string, Map<string, number>>
  >();
  private readonly latestTodosBySessionId = new Map<string, AgentSessionTodoItem[]>();
  private readonly threadDiffsByRuntimeId = new Map<string, Map<string, CodexThreadDiffState>>();
  private readonly runtimeEventProcessingByRuntimeId = new Map<string, Promise<void>>();
  private readonly runtimeEventGenerationByRuntimeId = new Map<string, symbol>();
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
    let generation = this.runtimeEventGenerationByRuntimeId.get(runtimeId);
    if (!generation) {
      generation = Symbol(runtimeId);
      this.runtimeEventGenerationByRuntimeId.set(runtimeId, generation);
    }
    return this.runtimeEventSubscriptions.ensure(runtimeId, (event) => {
      this.enqueueRuntimeStreamEvent(event, generation, onRuntimeEventQueueFailure);
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
    this.runtimeEventGenerationByRuntimeId.delete(runtimeId);
    this.runtimeEventProcessingByRuntimeId.delete(runtimeId);
    try {
      this.stopRuntimeEventSubscription(runtimeId);
    } finally {
      this.subagentLifecycle.clearRuntime(runtimeId);
      this.clearStartedItemTimestampsForRuntime(runtimeId);
      this.handledStreamRequestKeysByRuntimeId.delete(runtimeId);
      this.threadDiffsByRuntimeId.delete(runtimeId);
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

  initializeFreshThreadContextUsage(runtimeId: string, threadId: string): void {
    this.contextUsage.initializeFreshThread(runtimeId, threadId);
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
    generation: symbol,
    onRuntimeEventQueueFailure: CodexRuntimeEventQueueFailureHandler,
  ): void {
    const previous =
      this.runtimeEventProcessingByRuntimeId.get(event.runtimeId) ?? Promise.resolve();
    const processing = previous.then(() => {
      if (this.runtimeEventGenerationByRuntimeId.get(event.runtimeId) !== generation) {
        return;
      }
      return this.processRuntimeStreamEventMutation(event, generation);
    });
    const cleanup = processing.then(
      () => undefined,
      (error) => {
        onRuntimeEventQueueFailure({ runtimeId: event.runtimeId, error });
        return undefined;
      },
    );
    this.runtimeEventProcessingByRuntimeId.set(event.runtimeId, cleanup);
    void cleanup.then(() => {
      if (this.runtimeEventProcessingByRuntimeId.get(event.runtimeId) === cleanup) {
        this.runtimeEventProcessingByRuntimeId.delete(event.runtimeId);
      }
    });
  }

  private async processRuntimeStreamEventMutation(
    event: CodexRuntimeStreamEvent,
    generation: symbol,
  ): Promise<void> {
    const mutation: CodexRuntimeLiveSessionMutation = {
      runtimeId: event.runtimeId,
      transcriptEvents: [],
      catalogInvalidated: false,
    };
    this.activeMutationByRuntimeId.set(event.runtimeId, mutation);
    let owner: CodexRuntimeStreamEventSessionOwner | undefined;
    try {
      try {
        owner = this.prepareRuntimeStreamEvent(event);
        if (event.kind === "fault") {
          throw new Error(event.message);
        }
        if (owner) {
          await this.processRuntimeStreamEventForSession(owner, event);
        }
      } catch (error) {
        if (!this.runtimeStreamEventCanDeliver(event.runtimeId, generation, owner)) {
          return;
        }
        const retainedOwner = owner ?? this.runtimeStreamEventSessionOwner(event);
        Object.assign(mutation, {
          fault: this.errorMessage(error),
          ...(retainedOwner
            ? { faultRef: codexSessionRef(retainedOwner.targetSession) }
            : undefined),
        });
        this.emitRuntimeStreamEventError(event, error, retainedOwner);
      }
      if (!this.runtimeStreamEventCanDeliver(event.runtimeId, generation, owner)) {
        return;
      }
      const deliveries: Array<{ label: string; run: () => void | Promise<void> }> = [];
      if (mutation.catalogInvalidated && this.deps.onCatalogInvalidated) {
        deliveries.push({
          label: "catalog invalidation",
          run: () =>
            this.deps.onCatalogInvalidated?.({ runtimeId: event.runtimeId, catalog: "skills" }),
        });
      }
      if (this.deps.onLiveSessionMutation) {
        deliveries.push({
          label: "live session mutation",
          run: () => this.deps.onLiveSessionMutation?.(mutation),
        });
      }
      const deliveryResults = await Promise.allSettled(
        deliveries.map(({ run }) => Promise.resolve().then(run)),
      );
      const failures = deliveryResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ label: deliveries[index]?.label ?? "unknown delivery", error: result.reason }]
          : [],
      );
      if (failures.length === 1) {
        throw failures[0]?.error;
      }
      if (failures.length > 1) {
        const aggregate = new AggregateError(
          failures.map(({ error }) => error),
          `Codex runtime '${event.runtimeId}' delivery failed: ${failures
            .map(({ label, error }) => `${label}: ${this.errorMessage(error)}`)
            .join("; ")}.`,
        );
        throw aggregate;
      }
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

  sessionDiff(runtimeId: string, threadId: string, turnId?: string): string {
    const threadDiff = this.threadDiffsByRuntimeId.get(runtimeId)?.get(threadId);
    const selectedTurnId = turnId ?? threadDiff?.latestTurnId;
    const diff = selectedTurnId ? threadDiff?.byTurnId.get(selectedTurnId) : undefined;
    if (diff === undefined) {
      const turnDetail = turnId ? ` turn '${turnId}'` : " its latest turn";
      throw new Error(
        `Codex app-server has not streamed a turn/diff/updated notification for thread '${threadId}'${turnDetail} on runtime '${runtimeId}'.`,
      );
    }
    return diff;
  }

  clearSession(externalSessionId: string, runtimeId?: string): void {
    const routedDescendantThreadIds =
      runtimeId === undefined
        ? []
        : this.deps.subagents
            .descendantRoutesForParent(externalSessionId, runtimeId, (route) => {
              const retainedChild = this.deps.sessions.get(route.childExternalSessionId);
              return retainedChild?.runtimeId !== runtimeId;
            })
            .map((route) => route.childExternalSessionId);
    this.subagentLifecycle.clearSession(externalSessionId, runtimeId);
    if (runtimeId !== undefined) {
      this.clearStartedItemTimestampsForSession(runtimeId, externalSessionId);
      for (const threadId of routedDescendantThreadIds) {
        this.clearStartedItemTimestampsForSession(runtimeId, threadId);
      }
    }
    this.clearHandledStreamRequestKeys(externalSessionId, runtimeId);
    this.syntheticUserMessageTextsByThreadId.delete(externalSessionId);
    this.latestTodosBySessionId.delete(externalSessionId);
    this.clearSessionDiffs(externalSessionId, runtimeId);
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
      if (this.deps.sessions.get(activeTurn.session.threadId) !== activeTurn.session) {
        return;
      }
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

  private emitSubagentRouteError(route: CodexSubagentRoute, cause: unknown): void {
    const externalSessionId = this.deps.sessions.get(route.parentExternalSessionId)
      ? route.parentExternalSessionId
      : this.deps.sessions.get(route.childExternalSessionId)
        ? route.childExternalSessionId
        : null;
    if (!externalSessionId) {
      return;
    }
    this.emitSessionError(externalSessionId, cause);
  }

  private prepareRuntimeStreamEvent(
    event: CodexRuntimeStreamEvent,
  ): CodexRuntimeStreamEventSessionOwner | undefined {
    const notification =
      event.kind === "notification" ? { ...event.message, receivedAt: event.receivedAt } : null;
    if (notification) {
      this.observeCatalogInvalidation(event.runtimeId, notification);
    }
    if (notification?.method === "thread/tokenUsage/updated") {
      this.contextUsage.observeNotification(event.runtimeId, notification);
    }
    const isServerRequest = isServerRequestStreamEvent(event);
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (isServerRequest && event.kind !== "fault") {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId);
      }
      return;
    }
    if (notification?.method === "serverRequest/resolved") {
      this.handleServerRequestResolvedNotification(event.runtimeId, notification);
      return;
    }
    const session = this.deps.sessions.get(threadId);
    if (session && session.runtimeId !== event.runtimeId) {
      if (isServerRequest) {
        throw new Error(
          `Cannot route Codex server request for thread '${threadId}' from runtime '${event.runtimeId}' because the session belongs to runtime '${session.runtimeId}'.`,
        );
      }
      return;
    }
    if (notification) {
      this.subagentLifecycle.projectNotification(event.runtimeId, notification);
    }
    const owner = this.resolveRuntimeStreamEventSessionOwner(threadId, event.runtimeId);
    if (!owner) {
      if (isServerRequest) {
        throw new Error(
          `Cannot route Codex server request for thread '${threadId}' because no retained same-runtime session exists.`,
        );
      }
      return;
    }
    if (notification?.method === "turn/diff/updated") {
      this.rememberSessionDiff(
        event.runtimeId,
        notification.params.threadId,
        notification.params.turnId,
        notification.params.diff,
      );
    }
    return owner;
  }

  private rememberSessionDiff(
    runtimeId: string,
    threadId: string,
    turnId: string,
    diff: string,
  ): void {
    let threadDiffs = this.threadDiffsByRuntimeId.get(runtimeId);
    if (!threadDiffs) {
      threadDiffs = new Map();
      this.threadDiffsByRuntimeId.set(runtimeId, threadDiffs);
    }
    const threadDiff = threadDiffs.get(threadId) ?? {
      latestTurnId: turnId,
      byTurnId: new Map<string, string>(),
    };
    threadDiff.latestTurnId = turnId;
    threadDiff.byTurnId.set(turnId, diff);
    threadDiffs.set(threadId, threadDiff);
  }

  private clearSessionDiffs(threadId: string, runtimeId?: string): void {
    const runtimeIds = runtimeId ? [runtimeId] : [...this.threadDiffsByRuntimeId.keys()];
    for (const currentRuntimeId of runtimeIds) {
      const threadDiffs = this.threadDiffsByRuntimeId.get(currentRuntimeId);
      threadDiffs?.delete(threadId);
      if (threadDiffs?.size === 0) {
        this.threadDiffsByRuntimeId.delete(currentRuntimeId);
      }
    }
  }

  private handleServerRequestResolvedNotification(
    runtimeId: string,
    notification: Extract<CodexNotificationRecord, { method: "serverRequest/resolved" }>,
  ): void {
    this.resolvePendingServerRequest(
      notification.params.threadId,
      notification.params.requestId,
      runtimeId,
    );
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
        : undefined),
      ...codexSubagentRouteEventFields(route),
    };
    const activeTurn =
      pending.kind === "approval"
        ? this.deps.pendingInput.resolveApproval(entry.request.requestId, entry.runtimeId)
        : this.deps.pendingInput.resolveQuestion(entry.request.requestId, entry.runtimeId);
    const type = pending.kind === "approval" ? "approval_resolved" : "question_resolved";
    const owner = this.resolveRuntimeStreamEventSessionOwner(threadId, runtimeId);
    if (owner) {
      this.emitRoutedRequestEvent(owner.targetSession, {
        ...eventBase,
        type,
      });
    }
    if (activeTurn && !activeTurn.isTurnSettled()) {
      void this.continueTurnAfterPendingInput(activeTurn);
    }
    this.forgetHandledServerRequest(entry.runtimeId, entry.threadId, requestId);
    return true;
  }

  private emitRuntimeStreamEventError(
    event: CodexRuntimeStreamEvent,
    cause: unknown,
    owner: CodexRuntimeStreamEventSessionOwner | undefined,
  ): void {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      if (isServerRequestStreamEvent(event)) {
        this.emitUnroutableRuntimeServerRequest(event.runtimeId, this.errorMessage(cause));
      }
      return;
    }
    if (owner) {
      this.emitSessionErrorForSession(owner.targetSession, cause);
    }
  }

  private runtimeStreamEventSessionOwner(
    event: CodexRuntimeStreamEvent,
  ): CodexRuntimeStreamEventSessionOwner | undefined {
    const threadId = threadIdFromRuntimeStreamEvent(event);
    if (!threadId) {
      return undefined;
    }
    return this.resolveRuntimeStreamEventSessionOwner(threadId, event.runtimeId);
  }

  private retainedRuntimeStreamEventOwner(
    owner: CodexRuntimeStreamEventSessionOwner,
  ): CodexRuntimeStreamEventSessionOwner | undefined {
    return this.deps.sessions.get(owner.retainedSession.threadId) === owner.retainedSession
      ? owner
      : undefined;
  }

  private runtimeStreamEventCanDeliver(
    runtimeId: string,
    generation: symbol,
    owner: CodexRuntimeStreamEventSessionOwner | undefined,
  ): boolean {
    if (this.runtimeEventGenerationByRuntimeId.get(runtimeId) !== generation) {
      return false;
    }
    return !owner || this.retainedRuntimeStreamEventOwner(owner) !== undefined;
  }

  private resolveRuntimeStreamEventSessionOwner(
    targetExternalSessionId: string,
    runtimeId: string,
  ): CodexRuntimeStreamEventSessionOwner | undefined {
    const visited = new Set<string>();
    let currentExternalSessionId = targetExternalSessionId;
    while (!visited.has(currentExternalSessionId)) {
      visited.add(currentExternalSessionId);
      const retainedSession = this.deps.sessions.get(currentExternalSessionId);
      if (retainedSession) {
        return retainedSession.runtimeId === runtimeId
          ? {
              retainedSession,
              targetSession:
                currentExternalSessionId === targetExternalSessionId
                  ? retainedSession
                  : routedSession(retainedSession, targetExternalSessionId),
            }
          : undefined;
      }
      const route = this.deps.subagents.routeForChild(currentExternalSessionId, runtimeId);
      if (!route || (route.runtimeId && route.runtimeId !== runtimeId)) {
        return undefined;
      }
      currentExternalSessionId = route.parentExternalSessionId;
    }
    return undefined;
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
    owner: CodexRuntimeStreamEventSessionOwner,
    event: CodexRuntimeStreamEvent,
  ): Promise<void> {
    if (event.kind === "fault") {
      throw new Error(event.message);
    }
    if (event.kind === "notification") {
      await this.handlePendingNotifications(owner.targetSession, [
        { ...event.message, receivedAt: event.receivedAt },
      ]);
      return;
    }
    await this.processServerRequestsForSession(owner.retainedSession, [
      serverRequestFromRuntimeEvent(event, owner.retainedSession, owner.targetSession),
    ]);
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
        (await this.handleServerRequests(handledRequestKeys, ownerRequests)) || hasPendingInput;
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

  private observeCatalogInvalidation(
    runtimeId: string,
    notification: CodexRuntimeNotification,
  ): void {
    if (notification.method !== "skills/changed") {
      return;
    }
    const mutation = this.activeMutationByRuntimeId.get(runtimeId);
    if (mutation) {
      mutation.catalogInvalidated = true;
    }
  }

  private async handleServerRequests(
    handledRequestKeys: Set<string>,
    requests: CodexServerRequestEnvelope[],
  ): Promise<boolean> {
    let hasPendingInput = false;
    for (const { request, receivedAt, retainedSession, targetSession } of requests) {
      hasPendingInput =
        (await this.handleServerRequest(
          retainedSession,
          targetSession,
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
      syntheticUserMessageTextsByThreadId: this.syntheticUserMessageTextsByThreadId,
      completedAgentMessagesByTurnKey: this.completedAgentMessagesByTurnKey,
      tokenUsageByTurnKey: this.tokenUsageByTurnKey,
      modelByTurnKey: this.modelByTurnKey,
      latestTodosBySessionId: this.latestTodosBySessionId,
      eventMapperPipeline: this.eventMapperPipeline,
      recordStartedItemTimestamp: (runtimeId, threadId, itemId, startedAtMs) =>
        this.recordStartedItemTimestamp(runtimeId, threadId, itemId, startedAtMs),
      takeStartedItemTimestamp: (runtimeId, threadId, itemId) =>
        this.takeStartedItemTimestamp(runtimeId, threadId, itemId),
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

  private recordStartedItemTimestamp(
    runtimeId: string,
    threadId: string,
    itemId: string,
    startedAtMs: number,
  ): void {
    let timestampsByThreadId = this.startedItemTimestampsByRuntimeId.get(runtimeId);
    if (!timestampsByThreadId) {
      timestampsByThreadId = new Map();
      this.startedItemTimestampsByRuntimeId.set(runtimeId, timestampsByThreadId);
    }
    let timestampsByItemId = timestampsByThreadId.get(threadId);
    if (!timestampsByItemId) {
      timestampsByItemId = new Map();
      timestampsByThreadId.set(threadId, timestampsByItemId);
    }
    timestampsByItemId.set(itemId, startedAtMs);
  }

  private takeStartedItemTimestamp(
    runtimeId: string,
    threadId: string,
    itemId: string,
  ): number | undefined {
    const timestampsByThreadId = this.startedItemTimestampsByRuntimeId.get(runtimeId);
    const timestampsByItemId = timestampsByThreadId?.get(threadId);
    const startedAtMs = timestampsByItemId?.get(itemId);
    if (!timestampsByItemId?.delete(itemId)) {
      return undefined;
    }
    if (timestampsByItemId.size === 0) {
      timestampsByThreadId?.delete(threadId);
    }
    if (timestampsByThreadId?.size === 0) {
      this.startedItemTimestampsByRuntimeId.delete(runtimeId);
    }
    return startedAtMs;
  }

  private clearStartedItemTimestampsForSession(runtimeId: string, threadId: string): void {
    const timestampsByThreadId = this.startedItemTimestampsByRuntimeId.get(runtimeId);
    timestampsByThreadId?.delete(threadId);
    if (timestampsByThreadId?.size === 0) {
      this.startedItemTimestampsByRuntimeId.delete(runtimeId);
    }
  }

  private clearStartedItemTimestampsForRuntime(runtimeId: string): void {
    this.startedItemTimestampsByRuntimeId.delete(runtimeId);
  }

  private async handleServerRequest(
    session: CodexSessionState,
    targetSession: CodexSessionState,
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
      targetSession,
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
      emitRetainedSessionEvent: (session, event) => {
        if (this.deps.sessions.get(session.threadId) === session) {
          this.emitSessionEventForSession(session, event);
        }
      },
      emitRoutedRequestEvent: (eventTargetSession, event) =>
        this.emitRoutedRequestEvent(eventTargetSession, event),
    };
  }

  private emitRoutedRequestEvent(targetSession: CodexSessionState, event: AgentEvent): void {
    const immediateRoute = this.deps.subagents.routeForChild(
      targetSession.threadId,
      targetSession.runtimeId,
    );
    const retainedTarget = this.deps.sessions.get(targetSession.threadId);
    const retainedParent = immediateRoute
      ? this.deps.sessions.get(immediateRoute.parentExternalSessionId)
      : undefined;
    const parentInTargetRuntime =
      retainedParent?.runtimeId === targetSession.runtimeId ? retainedParent : undefined;

    if (retainedTarget) {
      this.emitSessionEventForSession(retainedTarget, event);
    }
    if (parentInTargetRuntime && parentInTargetRuntime !== retainedTarget) {
      this.emitSessionEventForSession(parentInTargetRuntime, {
        ...event,
        externalSessionId: parentInTargetRuntime.threadId,
      });
    }
    if (!retainedTarget && !parentInTargetRuntime) {
      this.emitSessionEventForSession(targetSession, event);
    }
  }

  private emitSessionError(externalSessionId: string, cause: unknown): void {
    const session = this.deps.sessions.get(externalSessionId);
    if (!session) {
      return;
    }
    this.emitSessionErrorForSession(session, cause);
  }

  private emitSessionErrorForSession(session: CodexSessionState, cause: unknown): void {
    this.emitSessionEventForSession(session, {
      type: "session_error",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      message: this.errorMessage(cause),
    });
  }

  private errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
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
      // SAFETY: The runtime adapter builds this value from the contract fields required by `AgentSessionTranscriptEvent`.
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
