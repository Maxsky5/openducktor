import type { Event } from "@opencode-ai/sdk/v2/client";
import type { RuntimeApprovalReplyOutcome, RuntimeKind } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentSessionActivity,
  AgentSessionSummary,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { classifyAgentSessionActivity } from "@openducktor/core";
import { toOpenCodePermissionReply } from "./approval-translation";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { unwrapData } from "./data-utils";
import { readEventSessionId } from "./event-stream/shared";
import { asUnknownRecord, readRecordProp, readStringProp } from "./guards";
import {
  listOpencodeRuntimeSnapshotSources,
  type OpencodeRuntimeSnapshotSource,
} from "./live-session-snapshots";
import { extractMessageTotalTokens, readMessageModelSelection } from "./message-normalizers";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
import { toOpenCodeRequestError } from "./request-errors";
import { observeRuntimeEvents, registerSession, releaseSessionRuntime } from "./session-registry";
import type {
  ClientFactory,
  OpencodeSdkAdapterOptions,
  RuntimeEventTransportRecord,
  SessionRecord,
} from "./types";

export type OpencodeLiveSessionContextUsage = {
  totalTokens: number;
  model?: AgentModelSelection;
};

export type OpencodeLiveSessionSnapshot = {
  runtimeId: string;
  ref: SessionRef;
  activity: AgentSessionActivity;
  title: string;
  startedAt: string;
  parentExternalSessionId?: string;
  pendingApprovals: AgentPendingApprovalRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
  contextUsage: OpencodeLiveSessionContextUsage | null;
};

export type OpencodeLiveSessionChange =
  | { type: "session_upsert"; snapshot: OpencodeLiveSessionSnapshot }
  | { type: "session_removed"; runtimeId: string; ref: SessionRef }
  | {
      type: "transcript_event";
      runtimeId: string;
      ref: SessionRef;
      event: OpencodeLiveTranscriptEvent;
    }
  | { type: "runtime_fault"; runtimeId: string; message: string };

type OpencodeLiveTranscriptEventType =
  | "assistant_delta"
  | "assistant_message"
  | "user_message"
  | "assistant_part"
  | "session_todos_updated"
  | "session_compaction_started"
  | "session_compacted"
  | "mcp_reconnect_started";

export type OpencodeLiveTranscriptEvent = Extract<
  AgentEvent,
  { type: OpencodeLiveTranscriptEventType }
>;

export type InitializeOpencodeLiveRuntimeInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  runtimeId: string;
  runtimeEndpoint: string;
  directories?: string[];
};

export type OpencodeLiveRuntimeAttachment = {
  snapshots: OpencodeLiveSessionSnapshot[];
  startForwarding: (
    listener: (change: OpencodeLiveSessionChange) => void | Promise<void>,
  ) => Promise<void>;
  release: () => Promise<void>;
};

export type ReplyOpencodeLiveApprovalInput = {
  runtimeId: string;
  ref: SessionRef;
  requestId: string;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
};

export type ReplyOpencodeLiveQuestionInput = {
  runtimeId: string;
  ref: SessionRef;
  requestId: string;
  answers: string[][];
};

type PendingRoute = {
  occurrenceId: string;
  nativeRequestId: string;
  kind: "approval" | "question";
  ref: SessionRef;
};

type RetainedSession = {
  snapshot: OpencodeLiveSessionSnapshot;
  runtimeActivity: OpencodeRuntimeSnapshotSource["runtimeActivity"];
};

type RuntimeState = {
  input: InitializeOpencodeLiveRuntimeInput;
  initializing: boolean;
  subscribersReady: boolean;
  bufferedEventsBeforeSubscribers: Event[];
  initializationEvents: Event[];
  pendingChanges: OpencodeLiveSessionChange[];
  pendingTranscriptChanges: OpencodeLiveSessionChange[];
  initializationHandoff: Promise<void> | null;
  forwardingListener: ((change: OpencodeLiveSessionChange) => void | Promise<void>) | null;
  deliveryTail: Promise<void>;
  mutationTail: Promise<void>;
  startingForwarding: boolean;
  released: boolean;
  sessions: Map<string, RetainedSession>;
  eventSessions: Map<string, SessionRecord>;
  controlAdapter: OpencodeSdkAdapter;
  routesByOccurrenceId: Map<string, PendingRoute>;
  occurrenceIdByNativeKey: Map<string, string>;
  contextUsageBySessionId: Map<string, OpencodeLiveSessionContextUsage>;
  contextLoads: Map<string, Promise<OpencodeLiveSessionContextUsage | null>>;
  observation: {
    dispatch: (event: Event) => Promise<void>;
    release: () => Promise<void>;
  } | null;
};

const LIVE_TRANSCRIPT_EVENT_TYPES: ReadonlySet<OpencodeLiveTranscriptEventType> = new Set([
  "assistant_delta",
  "assistant_message",
  "user_message",
  "assistant_part",
  "session_todos_updated",
  "session_compaction_started",
  "session_compacted",
  "mcp_reconnect_started",
]);

const isLiveTranscriptEvent = (event: AgentEvent): event is OpencodeLiveTranscriptEvent =>
  LIVE_TRANSCRIPT_EVENT_TYPES.has(event.type as OpencodeLiveTranscriptEventType);

const cloneSnapshot = (snapshot: OpencodeLiveSessionSnapshot): OpencodeLiveSessionSnapshot => ({
  ...snapshot,
  ref: { ...snapshot.ref },
  pendingApprovals: snapshot.pendingApprovals.map((request) => ({ ...request })),
  pendingQuestions: snapshot.pendingQuestions.map((request) => ({
    ...request,
    questions: request.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
    })),
  })),
  contextUsage: snapshot.contextUsage ? { ...snapshot.contextUsage } : null,
});

const refsEqual = (left: SessionRef, right: SessionRef): boolean =>
  left.repoPath === right.repoPath &&
  left.runtimeKind === right.runtimeKind &&
  left.workingDirectory === right.workingDirectory &&
  left.externalSessionId === right.externalSessionId;

const nativeRouteKey = (
  sessionId: string,
  kind: PendingRoute["kind"],
  nativeRequestId: string,
): string => `${sessionId}\u0000${kind}\u0000${nativeRequestId}`;

const SNAPSHOT_REFRESH_EVENT_TYPES = new Set<string>([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "permission.asked",
  "permission.v2.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
]);

const snapshotActivity = (
  runtimeActivity: OpencodeRuntimeSnapshotSource["runtimeActivity"],
  approvals: AgentPendingApprovalRequest[],
  questions: AgentPendingQuestionRequest[],
): AgentSessionActivity =>
  classifyAgentSessionActivity({
    runtimeActivity,
    pendingApprovals: approvals,
    pendingQuestions: questions,
  });

const readContextUsageFromEvent = (
  event: Event,
): { externalSessionId: string; contextUsage: OpencodeLiveSessionContextUsage } | null => {
  if (event.type !== "message.updated") {
    return null;
  }
  const properties = "properties" in event ? asUnknownRecord(event.properties) : null;
  const info = properties ? readRecordProp(properties, "info") : undefined;
  const externalSessionId = readEventSessionId(event);
  if (!info || !externalSessionId) {
    return null;
  }
  const rawParts = Array.isArray(properties?.parts) ? properties.parts : [];
  const totalTokens = extractMessageTotalTokens(info, rawParts);
  if (typeof totalTokens !== "number") {
    return null;
  }
  const model = readMessageModelSelection(info);
  return {
    externalSessionId,
    contextUsage: {
      totalTokens,
      ...(model ? { model } : {}),
    },
  };
};

const readLatestContextUsage = async (input: {
  createClient: ClientFactory;
  runtimeEndpoint: string;
  workingDirectory: string;
  externalSessionId: string;
}): Promise<OpencodeLiveSessionContextUsage | null> => {
  const client = input.createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.session.messages({
    directory: input.workingDirectory,
    sessionID: input.externalSessionId,
    limit: 1,
  });
  const messages = unwrapData(response, "load latest session context usage");
  const latestAssistant = [...messages]
    .reverse()
    .find(
      (message) => readStringProp(asUnknownRecord(message.info) ?? {}, ["role"]) === "assistant",
    );
  if (!latestAssistant) {
    return null;
  }
  const totalTokens = extractMessageTotalTokens(latestAssistant.info, latestAssistant.parts);
  if (typeof totalTokens !== "number") {
    return null;
  }
  const model = readMessageModelSelection(latestAssistant.info);
  return { totalTokens, ...(model ? { model } : {}) };
};

export interface OpencodeLiveSessionController {
  initializeRuntime(
    input: InitializeOpencodeLiveRuntimeInput,
  ): Promise<OpencodeLiveRuntimeAttachment>;
  readRuntimeSnapshots(runtimeId: string): OpencodeLiveSessionSnapshot[];
  loadSessionContextUsage(
    runtimeId: string,
    ref: SessionRef,
  ): Promise<OpencodeLiveSessionContextUsage | null>;
  replyApproval(input: ReplyOpencodeLiveApprovalInput): Promise<void>;
  replyQuestion(input: ReplyOpencodeLiveQuestionInput): Promise<void>;
  startSession(runtimeId: string, input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(runtimeId: string, input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  forkSession(runtimeId: string, input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  sendUserMessage(
    runtimeId: string,
    input: SendAgentUserMessageInput,
  ): Promise<AcceptedAgentUserMessage>;
  updateSessionModel(runtimeId: string, input: UpdateAgentSessionModelInput): Promise<void>;
  stopSession(runtimeId: string, input: SessionRef): Promise<void>;
  releaseSession(runtimeId: string, input: SessionRef): Promise<void>;
  releaseRuntime(runtimeId: string): Promise<void>;
}

class DefaultOpencodeLiveSessionController implements OpencodeLiveSessionController {
  private readonly createClient: ClientFactory;
  private readonly now: () => string;
  private readonly options: OpencodeSdkAdapterOptions;
  private readonly runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  private readonly runtimes = new Map<string, RuntimeState>();
  private nextOccurrence = 1;

  constructor(
    options: OpencodeSdkAdapterOptions,
    dependencies?: {
      runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
    },
  ) {
    this.options = options;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.now = options.now ?? nowIso;
    this.runtimeEventTransports = dependencies?.runtimeEventTransports ?? new Map();
  }

  async initializeRuntime(
    input: InitializeOpencodeLiveRuntimeInput,
  ): Promise<OpencodeLiveRuntimeAttachment> {
    if (input.runtimeKind !== "opencode") {
      throw new Error(`Cannot initialize OpenCode live state for runtime '${input.runtimeKind}'.`);
    }
    if (this.runtimes.has(input.runtimeId)) {
      throw new Error(`OpenCode live runtime '${input.runtimeId}' is already initialized.`);
    }

    const eventSessions = new Map<string, SessionRecord>();
    const controlAdapter = new OpencodeSdkAdapter(
      {
        ...this.options,
        repoRuntimeResolver: {
          requireRepoRuntime: async () => ({
            kind: "opencode",
            runtimeId: input.runtimeId,
            repoPath: input.repoPath,
            runtimeRoute: { type: "local_http", endpoint: input.runtimeEndpoint },
          }),
        },
      },
      {
        sessions: eventSessions,
        runtimeEventTransports: this.runtimeEventTransports,
      },
    );
    const state: RuntimeState = {
      input,
      initializing: true,
      subscribersReady: false,
      bufferedEventsBeforeSubscribers: [],
      initializationEvents: [],
      pendingChanges: [],
      pendingTranscriptChanges: [],
      initializationHandoff: null,
      forwardingListener: null,
      deliveryTail: Promise.resolve(),
      mutationTail: Promise.resolve(),
      startingForwarding: false,
      released: false,
      sessions: new Map(),
      eventSessions,
      controlAdapter,
      routesByOccurrenceId: new Map(),
      occurrenceIdByNativeKey: new Map(),
      contextUsageBySessionId: new Map(),
      contextLoads: new Map(),
      observation: null,
    };
    this.runtimes.set(input.runtimeId, state);

    try {
      state.observation = await observeRuntimeEvents({
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeId: input.runtimeId,
        runtimeEndpoint: input.runtimeEndpoint,
        sessions: state.eventSessions,
        now: this.now,
        emit: (externalSessionId, event) => {
          this.captureTranscriptEvent(state, externalSessionId, event);
        },
        observer: async (event) => {
          if (state.initializing) {
            state.initializationEvents.push(event);
            if (!state.subscribersReady) {
              state.bufferedEventsBeforeSubscribers.push(event);
            }
            return;
          }
          await state.initializationHandoff;
          if (!state.released) {
            await this.applyRuntimeEvent(state, event);
          }
        },
        terminalObserver: async (error) => {
          const detail = error.message.trim();
          const message = detail.startsWith("OpenCode live event observation")
            ? detail
            : `OpenCode live event observation failed: ${detail || "unknown failure"}`;
          await this.emit(state, {
            type: "runtime_fault",
            runtimeId: input.runtimeId,
            message,
          });
        },
      });
      await this.refreshRuntime(state, false);
      state.subscribersReady = true;
      for (const event of state.bufferedEventsBeforeSubscribers.splice(0)) {
        await state.observation.dispatch(event);
      }
      let resolveHandoff: () => void = () => undefined;
      state.initializationHandoff = new Promise<void>((resolve) => {
        resolveHandoff = resolve;
      });
      state.initializing = false;
      let snapshots: OpencodeLiveSessionSnapshot[];
      try {
        const bufferedEvents = state.initializationEvents.splice(0);
        for (const event of bufferedEvents) {
          await this.retainContextEvent(state, event, false);
        }
        if (bufferedEvents.some((event) => SNAPSHOT_REFRESH_EVENT_TYPES.has(String(event.type)))) {
          await this.refreshRuntime(state, false);
        }
        await this.drainTranscriptChanges(state);
        snapshots = this.snapshotState(state);
      } finally {
        state.initializationHandoff = null;
        resolveHandoff();
      }
      return {
        snapshots,
        startForwarding: (nextListener) => this.startForwarding(state, nextListener),
        release: () => this.releaseRuntime(input.runtimeId),
      };
    } catch (error) {
      this.runtimes.delete(input.runtimeId);
      state.released = true;
      state.forwardingListener = null;
      await this.releaseEventSessions(state);
      await state.observation?.release();
      throw error;
    }
  }

  readRuntimeSnapshots(runtimeId: string): OpencodeLiveSessionSnapshot[] {
    return this.snapshotState(this.requireRuntime(runtimeId));
  }

  async loadSessionContextUsage(
    runtimeId: string,
    ref: SessionRef,
  ): Promise<OpencodeLiveSessionContextUsage | null> {
    const state = this.requireRuntime(runtimeId);
    const retained = this.requireSession(state, ref);
    if (retained.snapshot.contextUsage) {
      return { ...retained.snapshot.contextUsage };
    }
    const existingLoad = state.contextLoads.get(ref.externalSessionId);
    if (existingLoad) {
      return existingLoad;
    }
    const load = readLatestContextUsage({
      createClient: this.createClient,
      runtimeEndpoint: state.input.runtimeEndpoint,
      workingDirectory: ref.workingDirectory,
      externalSessionId: ref.externalSessionId,
    })
      .then((contextUsage) =>
        this.runRuntimeMutation(
          state,
          async () => {
            const requireActiveRuntime = () => {
              if (state.released || this.runtimes.get(runtimeId) !== state) {
                throw new Error(
                  `OpenCode runtime '${runtimeId}' was released while context usage was loading.`,
                );
              }
            };
            requireActiveRuntime();
            const contextReceivedWhileLoading = state.contextUsageBySessionId.get(
              ref.externalSessionId,
            );
            if (contextReceivedWhileLoading) {
              return { ...contextReceivedWhileLoading };
            }
            if (!contextUsage) {
              return null;
            }
            const current = this.requireSession(state, ref);
            current.snapshot = { ...current.snapshot, contextUsage };
            state.contextUsageBySessionId.set(ref.externalSessionId, contextUsage);
            await this.emit(state, {
              type: "session_upsert",
              snapshot: cloneSnapshot(current.snapshot),
            });
            requireActiveRuntime();
            return { ...contextUsage };
          },
          `OpenCode runtime '${runtimeId}' was released while context usage was loading.`,
        ),
      )
      .finally(() => {
        state.contextLoads.delete(ref.externalSessionId);
      });
    state.contextLoads.set(ref.externalSessionId, load);
    return load;
  }

  async replyApproval(input: ReplyOpencodeLiveApprovalInput): Promise<void> {
    const state = this.requireRuntime(input.runtimeId);
    await this.runRuntimeMutation(state, async () => {
      const { route } = this.requirePendingRoute(
        input.runtimeId,
        input.ref,
        input.requestId,
        "approval",
      );
      const client = this.createClient({
        runtimeEndpoint: state.input.runtimeEndpoint,
        workingDirectory: route.ref.workingDirectory,
      });
      const response = await client.permission.reply({
        directory: route.ref.workingDirectory,
        requestID: route.nativeRequestId,
        reply: toOpenCodePermissionReply(input.outcome),
        ...(input.message ? { message: input.message } : {}),
      });
      if (response.error) {
        throw toOpenCodeRequestError(
          "reply to permission request",
          response.error,
          response.response,
        );
      }
      if (!state.routesByOccurrenceId.has(route.occurrenceId)) {
        return;
      }
      const currentSession = this.requireSession(state, input.ref);
      currentSession.snapshot = {
        ...currentSession.snapshot,
        pendingApprovals: currentSession.snapshot.pendingApprovals.filter(
          (request) => request.requestId !== route.occurrenceId,
        ),
      };
      await this.finishPendingReply(state, currentSession, route);
    });
  }

  async replyQuestion(input: ReplyOpencodeLiveQuestionInput): Promise<void> {
    const state = this.requireRuntime(input.runtimeId);
    await this.runRuntimeMutation(state, async () => {
      const { route } = this.requirePendingRoute(
        input.runtimeId,
        input.ref,
        input.requestId,
        "question",
      );
      const client = this.createClient({
        runtimeEndpoint: state.input.runtimeEndpoint,
        workingDirectory: route.ref.workingDirectory,
      });
      const response = await client.question.reply({
        directory: route.ref.workingDirectory,
        requestID: route.nativeRequestId,
        answers: input.answers,
      });
      if (response.error) {
        throw toOpenCodeRequestError(
          "reply to question request",
          response.error,
          response.response,
        );
      }
      if (!state.routesByOccurrenceId.has(route.occurrenceId)) {
        return;
      }
      const currentSession = this.requireSession(state, input.ref);
      currentSession.snapshot = {
        ...currentSession.snapshot,
        pendingQuestions: currentSession.snapshot.pendingQuestions.filter(
          (request) => request.requestId !== route.occurrenceId,
        ),
      };
      await this.finishPendingReply(state, currentSession, route);
    });
  }

  async startSession(
    runtimeId: string,
    input: StartAgentSessionInput,
  ): Promise<AgentSessionSummary> {
    const state = this.requireControlRuntime(runtimeId, input, "start session");
    const summary = await state.controlAdapter.startSession(input);
    await this.retainControlSummary(state, summary);
    return summary;
  }

  async resumeSession(
    runtimeId: string,
    input: ResumeAgentSessionInput,
  ): Promise<AgentSessionSummary> {
    const state = this.requireControlRuntime(runtimeId, input, "resume session");
    const summary = await state.controlAdapter.resumeSession(input);
    await this.retainControlSummary(state, summary);
    return summary;
  }

  async forkSession(runtimeId: string, input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    const state = this.requireControlRuntime(runtimeId, input, "fork session");
    const summary = await state.controlAdapter.forkSession(input);
    await this.retainControlSummary(state, summary, input.parentExternalSessionId);
    return summary;
  }

  async sendUserMessage(
    runtimeId: string,
    input: SendAgentUserMessageInput,
  ): Promise<AcceptedAgentUserMessage> {
    const state = this.requireControlRuntime(runtimeId, input, "send user message");
    this.requireSession(state, input);
    const accepted = await state.controlAdapter.sendUserMessage(input);
    const retained = this.requireSession(state, input);
    retained.runtimeActivity = "running";
    retained.snapshot = {
      ...retained.snapshot,
      activity: snapshotActivity(
        retained.runtimeActivity,
        retained.snapshot.pendingApprovals,
        retained.snapshot.pendingQuestions,
      ),
    };
    await this.emit(state, {
      type: "session_upsert",
      snapshot: cloneSnapshot(retained.snapshot),
    });
    await this.emit(state, {
      type: "transcript_event",
      runtimeId,
      ref: { ...retained.snapshot.ref },
      event: accepted,
    });
    return accepted;
  }

  async updateSessionModel(runtimeId: string, input: UpdateAgentSessionModelInput): Promise<void> {
    const state = this.requireControlRuntime(runtimeId, input, "update session model");
    this.requireSession(state, input);
    await state.controlAdapter.updateSessionModel(input);
  }

  async stopSession(runtimeId: string, input: SessionRef): Promise<void> {
    const state = this.requireControlRuntime(runtimeId, input, "stop session");
    this.requireSession(state, input);
    await state.controlAdapter.stopSession(input);
    await this.removeControlledSession(state, input);
  }

  async releaseSession(runtimeId: string, input: SessionRef): Promise<void> {
    const state = this.requireControlRuntime(runtimeId, input, "release session");
    await state.controlAdapter.releaseSession(input);
    await this.removeControlledSession(state, input);
  }

  async releaseRuntime(runtimeId: string): Promise<void> {
    const state = this.runtimes.get(runtimeId);
    if (!state) {
      return;
    }
    this.runtimes.delete(runtimeId);
    state.released = true;
    state.forwardingListener = null;
    const observation = state.observation;
    const failures: Error[] = [];
    try {
      await this.releaseEventSessions(state);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error("OpenCode session cleanup failed."));
    }
    try {
      await observation?.release();
    } catch (error) {
      failures.push(
        error instanceof Error ? error : new Error("OpenCode observation cleanup failed."),
      );
    } finally {
      state.observation = null;
      state.pendingChanges.length = 0;
      state.pendingTranscriptChanges.length = 0;
      state.sessions.clear();
      state.eventSessions.clear();
      state.routesByOccurrenceId.clear();
      state.occurrenceIdByNativeKey.clear();
      state.contextUsageBySessionId.clear();
      state.contextLoads.clear();
      state.bufferedEventsBeforeSubscribers.length = 0;
      state.initializationEvents.length = 0;
      state.initializationHandoff = null;
      state.startingForwarding = false;
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to release OpenCode live runtime '${runtimeId}': ${failures
          .map((failure) => failure.message)
          .join("; ")}`,
      );
    }
  }

  private async applyRuntimeEvent(state: RuntimeState, event: Event): Promise<void> {
    await this.runRuntimeMutation(state, async () => {
      await this.drainTranscriptChanges(state);
      await this.retainContextEvent(state, event, true);
      if (SNAPSHOT_REFRESH_EVENT_TYPES.has(String(event.type))) {
        await this.refreshRuntime(state, true);
      }
    });
  }

  private async retainContextEvent(
    state: RuntimeState,
    event: Event,
    emit: boolean,
  ): Promise<{ externalSessionId: string } | null> {
    const retained = readContextUsageFromEvent(event);
    if (!retained) {
      return null;
    }
    state.contextUsageBySessionId.set(retained.externalSessionId, retained.contextUsage);
    const session = state.sessions.get(retained.externalSessionId);
    if (!session) {
      return null;
    }
    session.snapshot = { ...session.snapshot, contextUsage: retained.contextUsage };
    if (emit) {
      await this.emit(state, {
        type: "session_upsert",
        snapshot: cloneSnapshot(session.snapshot),
      });
    }
    return { externalSessionId: retained.externalSessionId };
  }

  private async refreshRuntime(state: RuntimeState, emitChanges: boolean): Promise<void> {
    const sources = await listOpencodeRuntimeSnapshotSources({
      createClient: this.createClient,
      runtimeEndpoint: state.input.runtimeEndpoint,
      now: this.now,
      ...(state.input.directories ? { directories: state.input.directories } : {}),
    });
    this.requireActiveRuntimeState(state);
    const previous = state.sessions;
    const next = new Map<string, RetainedSession>();
    const activeNativeKeys = new Set<string>();

    for (const source of sources) {
      const ref: SessionRef = {
        repoPath: state.input.repoPath,
        runtimeKind: state.input.runtimeKind,
        workingDirectory: source.workingDirectory,
        externalSessionId: source.externalSessionId,
      };
      const approvals = source.pendingApprovals.map((request) =>
        this.toOpaquePending(state, ref, "approval", request, activeNativeKeys),
      );
      const questions = source.pendingQuestions.map((request) =>
        this.toOpaquePending(state, ref, "question", request, activeNativeKeys),
      );
      const snapshot: OpencodeLiveSessionSnapshot = {
        runtimeId: state.input.runtimeId,
        ref,
        activity: snapshotActivity(source.runtimeActivity, approvals, questions),
        title: source.title,
        startedAt: source.startedAt,
        ...(source.parentExternalSessionId
          ? { parentExternalSessionId: source.parentExternalSessionId }
          : {}),
        pendingApprovals: approvals,
        pendingQuestions: questions,
        contextUsage: state.contextUsageBySessionId.get(source.externalSessionId) ?? null,
      };
      next.set(source.externalSessionId, { snapshot, runtimeActivity: source.runtimeActivity });
    }

    await this.syncEventSessions(state, sources);
    this.requireActiveRuntimeState(state);

    for (const [key, occurrenceId] of state.occurrenceIdByNativeKey) {
      if (activeNativeKeys.has(key)) {
        continue;
      }
      state.occurrenceIdByNativeKey.delete(key);
      state.routesByOccurrenceId.delete(occurrenceId);
    }
    state.sessions = next;
    if (!emitChanges) {
      return;
    }
    for (const [sessionId, retained] of next) {
      if (JSON.stringify(previous.get(sessionId)?.snapshot) !== JSON.stringify(retained.snapshot)) {
        await this.emit(state, {
          type: "session_upsert",
          snapshot: cloneSnapshot(retained.snapshot),
        });
      }
    }
    for (const [sessionId, retained] of previous) {
      if (!next.has(sessionId)) {
        state.contextUsageBySessionId.delete(sessionId);
        await this.emit(state, {
          type: "session_removed",
          runtimeId: state.input.runtimeId,
          ref: { ...retained.snapshot.ref },
        });
      }
    }
  }

  private toOpaquePending<T extends AgentPendingApprovalRequest | AgentPendingQuestionRequest>(
    state: RuntimeState,
    ref: SessionRef,
    kind: PendingRoute["kind"],
    request: T,
    activeNativeKeys: Set<string>,
  ): T {
    const key = nativeRouteKey(ref.externalSessionId, kind, request.requestId);
    activeNativeKeys.add(key);
    let occurrenceId = state.occurrenceIdByNativeKey.get(key);
    if (!occurrenceId) {
      occurrenceId = `opencode-pending-${this.nextOccurrence++}`;
      state.occurrenceIdByNativeKey.set(key, occurrenceId);
    }
    state.routesByOccurrenceId.set(occurrenceId, {
      occurrenceId,
      nativeRequestId: request.requestId,
      kind,
      ref,
    });
    return { ...request, requestId: occurrenceId, requestInstanceId: occurrenceId };
  }

  private async finishPendingReply(
    state: RuntimeState,
    session: RetainedSession,
    route: PendingRoute,
  ): Promise<void> {
    state.routesByOccurrenceId.delete(route.occurrenceId);
    state.occurrenceIdByNativeKey.delete(
      nativeRouteKey(route.ref.externalSessionId, route.kind, route.nativeRequestId),
    );
    session.snapshot = {
      ...session.snapshot,
      activity: snapshotActivity(
        session.runtimeActivity,
        session.snapshot.pendingApprovals,
        session.snapshot.pendingQuestions,
      ),
    };
    await this.emit(state, {
      type: "session_upsert",
      snapshot: cloneSnapshot(session.snapshot),
    });
  }

  private requireActiveRuntimeState(state: RuntimeState, message?: string): void {
    if (state.released || this.runtimes.get(state.input.runtimeId) !== state) {
      throw new Error(
        message ?? `OpenCode live runtime '${state.input.runtimeId}' has been released.`,
      );
    }
  }

  private runRuntimeMutation<Success>(
    state: RuntimeState,
    mutation: () => Promise<Success>,
    releasedMessage?: string,
  ): Promise<Success> {
    const result = state.mutationTail.then(() => {
      this.requireActiveRuntimeState(state, releasedMessage);
      return mutation();
    });
    state.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireRuntime(runtimeId: string): RuntimeState {
    const state = this.runtimes.get(runtimeId);
    if (!state) {
      throw new Error(`Unknown OpenCode live runtime '${runtimeId}'.`);
    }
    return state;
  }

  private requireControlRuntime(
    runtimeId: string,
    input: { repoPath: string; runtimeKind: RuntimeKind },
    operation: string,
  ): RuntimeState {
    const state = this.requireRuntime(runtimeId);
    if (input.runtimeKind !== "opencode" || input.repoPath !== state.input.repoPath) {
      throw new Error(
        `Cannot ${operation} through OpenCode live runtime '${runtimeId}' for runtime '${input.runtimeKind}' in repo '${input.repoPath}'.`,
      );
    }
    return state;
  }

  private async retainControlSummary(
    state: RuntimeState,
    summary: AgentSessionSummary,
    parentExternalSessionId?: string,
  ): Promise<void> {
    if (summary.runtimeKind !== "opencode") {
      throw new Error(
        `OpenCode live runtime '${state.input.runtimeId}' returned session '${summary.externalSessionId}' with runtime kind '${summary.runtimeKind}'.`,
      );
    }
    const previous = state.sessions.get(summary.externalSessionId);
    const runtimeActivity =
      summary.status === "starting" || summary.status === "running" ? "running" : "idle";
    const retainedParentExternalSessionId =
      parentExternalSessionId ?? previous?.snapshot.parentExternalSessionId;
    const snapshot: OpencodeLiveSessionSnapshot = {
      runtimeId: state.input.runtimeId,
      ref: {
        repoPath: state.input.repoPath,
        runtimeKind: "opencode",
        workingDirectory: summary.workingDirectory,
        externalSessionId: summary.externalSessionId,
      },
      activity: snapshotActivity(
        runtimeActivity,
        previous?.snapshot.pendingApprovals ?? [],
        previous?.snapshot.pendingQuestions ?? [],
      ),
      title: summary.title ?? previous?.snapshot.title ?? "OpenCode",
      startedAt: summary.startedAt,
      ...(retainedParentExternalSessionId
        ? { parentExternalSessionId: retainedParentExternalSessionId }
        : {}),
      pendingApprovals: previous?.snapshot.pendingApprovals ?? [],
      pendingQuestions: previous?.snapshot.pendingQuestions ?? [],
      contextUsage:
        state.contextUsageBySessionId.get(summary.externalSessionId) ??
        previous?.snapshot.contextUsage ??
        null,
    };
    state.sessions.set(summary.externalSessionId, { snapshot, runtimeActivity });
    await this.emit(state, { type: "session_upsert", snapshot: cloneSnapshot(snapshot) });
  }

  private async removeControlledSession(state: RuntimeState, ref: SessionRef): Promise<void> {
    const retained = state.sessions.get(ref.externalSessionId);
    if (!retained || !refsEqual(retained.snapshot.ref, ref)) {
      return;
    }
    state.sessions.delete(ref.externalSessionId);
    state.contextUsageBySessionId.delete(ref.externalSessionId);
    for (const [occurrenceId, route] of state.routesByOccurrenceId) {
      if (!refsEqual(route.ref, ref)) {
        continue;
      }
      state.routesByOccurrenceId.delete(occurrenceId);
      state.occurrenceIdByNativeKey.delete(
        nativeRouteKey(route.ref.externalSessionId, route.kind, route.nativeRequestId),
      );
    }
    state.pendingTranscriptChanges = state.pendingTranscriptChanges.filter(
      (change) => change.type !== "transcript_event" || !refsEqual(change.ref, ref),
    );
    await this.emit(state, {
      type: "session_removed",
      runtimeId: state.input.runtimeId,
      ref: { ...ref },
    });
  }

  private requireSession(state: RuntimeState, ref: SessionRef): RetainedSession {
    const session = state.sessions.get(ref.externalSessionId);
    if (!session || !refsEqual(session.snapshot.ref, ref)) {
      throw new Error(
        `OpenCode live session '${ref.externalSessionId}' does not belong to runtime '${state.input.runtimeId}' with the supplied session reference.`,
      );
    }
    return session;
  }

  private requirePendingRoute(
    runtimeId: string,
    ref: SessionRef,
    occurrenceId: string,
    kind: PendingRoute["kind"],
  ): { state: RuntimeState; route: PendingRoute; session: RetainedSession } {
    const state = this.requireRuntime(runtimeId);
    const session = this.requireSession(state, ref);
    const route = state.routesByOccurrenceId.get(occurrenceId);
    if (!route || route.kind !== kind || !refsEqual(route.ref, ref)) {
      throw new Error(
        `Unknown or resolved OpenCode ${kind} occurrence '${occurrenceId}' for session '${ref.externalSessionId}' in runtime '${runtimeId}'.`,
      );
    }
    return { state, route, session };
  }

  private snapshotState(state: RuntimeState): OpencodeLiveSessionSnapshot[] {
    return [...state.sessions.values()].map(({ snapshot }) => cloneSnapshot(snapshot));
  }

  private async emit(state: RuntimeState, change: OpencodeLiveSessionChange): Promise<void> {
    if (state.released) {
      return;
    }
    if (!state.forwardingListener) {
      state.pendingChanges.push(change);
      return;
    }
    const listener = state.forwardingListener;
    const delivery = state.deliveryTail.then(() => listener(change));
    state.deliveryTail = delivery.then(
      () => undefined,
      () => undefined,
    );
    await delivery;
  }

  private captureTranscriptEvent(
    state: RuntimeState,
    externalSessionId: string,
    event: AgentEvent,
  ): void {
    if (state.released || !isLiveTranscriptEvent(event)) {
      return;
    }
    const retained = state.sessions.get(externalSessionId);
    if (!retained) {
      return;
    }
    state.pendingTranscriptChanges.push({
      type: "transcript_event",
      runtimeId: state.input.runtimeId,
      ref: { ...retained.snapshot.ref },
      event,
    });
  }

  private async drainTranscriptChanges(state: RuntimeState): Promise<void> {
    while (state.pendingTranscriptChanges.length > 0) {
      const change = state.pendingTranscriptChanges[0];
      if (!change) {
        return;
      }
      await this.emit(state, change);
      state.pendingTranscriptChanges.shift();
    }
  }

  private async startForwarding(
    state: RuntimeState,
    listener: (change: OpencodeLiveSessionChange) => void | Promise<void>,
  ): Promise<void> {
    if (state.released || this.runtimes.get(state.input.runtimeId) !== state) {
      throw new Error(`OpenCode live runtime '${state.input.runtimeId}' has been released.`);
    }
    if (state.forwardingListener || state.startingForwarding) {
      throw new Error(`OpenCode live runtime '${state.input.runtimeId}' is already forwarding.`);
    }
    state.startingForwarding = true;
    try {
      while (state.pendingChanges.length > 0) {
        const change = state.pendingChanges[0];
        if (!change) {
          break;
        }
        await listener(change);
        if (state.released) {
          throw new Error(`OpenCode live runtime '${state.input.runtimeId}' has been released.`);
        }
        state.pendingChanges.shift();
      }
      if (state.released) {
        throw new Error(`OpenCode live runtime '${state.input.runtimeId}' has been released.`);
      }
      state.forwardingListener = listener;
    } finally {
      state.startingForwarding = false;
    }
  }

  private async syncEventSessions(
    state: RuntimeState,
    sources: OpencodeRuntimeSnapshotSource[],
  ): Promise<void> {
    const activeSessionIds = new Set(sources.map((source) => source.externalSessionId));
    for (const session of [...state.eventSessions.values()]) {
      if (!activeSessionIds.has(session.externalSessionId)) {
        await releaseSessionRuntime(session, state.eventSessions, this.runtimeEventTransports);
      }
    }
    for (const source of sources) {
      const existing = state.eventSessions.get(source.externalSessionId);
      if (existing?.input.workingDirectory === source.workingDirectory) {
        continue;
      }
      if (existing) {
        await releaseSessionRuntime(existing, state.eventSessions, this.runtimeEventTransports);
      }
      const sessionInput = {
        repoPath: state.input.repoPath,
        runtimeKind: "opencode" as const,
        workingDirectory: source.workingDirectory,
        runtimePolicy: { kind: "opencode" as const },
        systemPrompt: "",
      };
      registerSession({
        sessions: state.eventSessions,
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeId: state.input.runtimeId,
        runtimeEndpoint: state.input.runtimeEndpoint,
        externalSessionId: source.externalSessionId,
        sessionInput,
        client: this.createClient({
          runtimeEndpoint: state.input.runtimeEndpoint,
          workingDirectory: source.workingDirectory,
        }),
        startedAt: source.startedAt,
        emitStartedEvent: false,
        now: this.now,
        emit: (externalSessionId, event) => {
          this.captureTranscriptEvent(state, externalSessionId, event);
        },
      });
    }
  }

  private async releaseEventSessions(state: RuntimeState): Promise<void> {
    const failures: Error[] = [];
    for (const session of [...state.eventSessions.values()]) {
      try {
        await releaseSessionRuntime(session, state.eventSessions, this.runtimeEventTransports);
      } catch (error) {
        failures.push(
          error instanceof Error
            ? error
            : new Error(`OpenCode session '${session.externalSessionId}' cleanup failed.`),
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to release ${failures.length} OpenCode live session ${
          failures.length === 1 ? "resource" : "resources"
        }: ${failures.map((failure) => failure.message).join("; ")}`,
      );
    }
  }
}

export const createOpencodeLiveSessionController = (
  options: OpencodeSdkAdapterOptions = {},
): OpencodeLiveSessionController => new DefaultOpencodeLiveSessionController(options);
