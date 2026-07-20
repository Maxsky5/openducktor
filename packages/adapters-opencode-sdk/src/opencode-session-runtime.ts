import type { Event } from "@opencode-ai/sdk/v2/client";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentSessionSummary,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { buildDefaultFactory, nowIso } from "./client-factory";
import {
  listOpencodeRuntimeSnapshotSources,
  type OpencodeRuntimeSnapshotSource,
} from "./live-session-snapshots";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
import {
  type OpencodeNativeApprovalReply,
  type OpencodeNativeQuestionReply,
  readLatestOpencodeContextUsage,
  replyToOpencodeApproval,
  replyToOpencodeQuestion,
} from "./opencode-session-native-operations";
import {
  isOpencodeSessionTranscriptEvent,
  type OpencodeSessionContextUsage,
  type OpencodeSessionRuntimeSignal,
  opencodeEventInvalidatesSessions,
  readOpencodeSessionContextSignal,
  toOpencodeObservationFailureMessage,
} from "./opencode-session-runtime-signals";
import { observeRuntimeEvents, registerSession, releaseSessionRuntime } from "./session-registry";
import type {
  OpencodeSdkAdapterOptions,
  RuntimeEventTransportRecord,
  SessionRecord,
} from "./types";

export type PrepareOpencodeSessionRuntimeInput = {
  readonly repoPath: string;
  readonly runtimeId: string;
  readonly runtimeEndpoint: string;
  readonly directories?: string[];
  readonly signal?: AbortSignal;
};

export type {
  OpencodeNativeApprovalReply,
  OpencodeNativeQuestionReply,
} from "./opencode-session-native-operations";

export type OpencodeSessionRuntimeConnection = {
  readonly readSessionSources: () => Promise<OpencodeRuntimeSnapshotSource[]>;
  readonly loadContextUsage: (ref: SessionRef) => Promise<OpencodeSessionContextUsage | null>;
  readonly replyApproval: (input: OpencodeNativeApprovalReply) => Promise<void>;
  readonly replyQuestion: (input: OpencodeNativeQuestionReply) => Promise<void>;
  readonly startSession: (input: StartAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly resumeSession: (input: ResumeAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly forkSession: (input: ForkAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly sendUserMessage: (input: SendAgentUserMessageInput) => Promise<AcceptedAgentUserMessage>;
  readonly updateSessionModel: (input: UpdateAgentSessionModelInput) => Promise<void>;
  readonly stopSession: (input: SessionRef) => Promise<void>;
  readonly releaseSession: (input: SessionRef) => Promise<void>;
};

export type PreparedOpencodeSessionRuntime = {
  readonly connection: OpencodeSessionRuntimeConnection;
  readonly initialSources: OpencodeRuntimeSnapshotSource[];
  readonly initialContextUsageBySessionId: ReadonlyMap<string, OpencodeSessionContextUsage>;
  readonly startForwarding: (
    listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
  ) => Promise<void>;
  readonly release: () => Promise<void>;
};

export type PrepareOpencodeSessionRuntime = (
  input: PrepareOpencodeSessionRuntimeInput,
) => Promise<PreparedOpencodeSessionRuntime>;

const runtimeInitializationAbortFailure = (signal: AbortSignal, runtimeId: string): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new Error(`OpenCode runtime '${runtimeId}' initialization was aborted.`);

const waitForRuntimeInitialization = <Value>(
  initialization: Promise<Value>,
  signal: AbortSignal | undefined,
  runtimeId: string,
): Promise<Value> => {
  if (!signal) return initialization;
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      complete();
    };
    const abort = (): void =>
      finish(() => reject(runtimeInitializationAbortFailure(signal, runtimeId)));
    signal.addEventListener("abort", abort, { once: true });
    void initialization.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) abort();
  });
};

const releaseEventSessions = async (
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  const failures: Error[] = [];
  for (const session of [...sessions.values()]) {
    try {
      await releaseSessionRuntime(session, sessions, runtimeEventTransports);
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
      `Failed to release ${failures.length} OpenCode session ${
        failures.length === 1 ? "resource" : "resources"
      }: ${failures.map((failure) => failure.message).join("; ")}`,
    );
  }
};

export const createPrepareOpencodeSessionRuntime = (
  options: OpencodeSdkAdapterOptions = {},
): PrepareOpencodeSessionRuntime => {
  const createClient = options.createClient ?? buildDefaultFactory();
  const now = options.now ?? nowIso;
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();

  return async (input) => {
    const eventSessions = new Map<string, SessionRecord>();
    const controlAdapter = new OpencodeSdkAdapter(
      {
        ...options,
        repoRuntimeResolver: {
          requireRepoRuntime: async () => ({
            kind: "opencode",
            runtimeId: input.runtimeId,
            repoPath: input.repoPath,
            runtimeRoute: { type: "local_http", endpoint: input.runtimeEndpoint },
          }),
        },
      },
      { sessions: eventSessions, runtimeEventTransports },
    );
    const pendingSignals: OpencodeSessionRuntimeSignal[] = [];
    const pendingTranscriptSignals: OpencodeSessionRuntimeSignal[] = [];
    const eventsBeforeSubscribers: Event[] = [];
    const initializationEvents: Event[] = [];
    const contextUsageBySessionId = new Map<string, OpencodeSessionContextUsage>();
    let forwardingListener:
      | ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>)
      | null = null;
    let deliveryTail = Promise.resolve();
    let startingForwarding = false;
    let initializing = true;
    let subscribersReady = false;
    let released = false;

    const requireActive = (): void => {
      if (released) {
        throw new Error(`OpenCode runtime '${input.runtimeId}' has been released.`);
      }
    };

    const emitSignal = async (signal: OpencodeSessionRuntimeSignal): Promise<void> => {
      if (released) {
        return;
      }
      if (!forwardingListener) {
        pendingSignals.push(signal);
        return;
      }
      const listener = forwardingListener;
      const delivery = deliveryTail.then(() => listener(signal));
      deliveryTail = delivery.then(
        () => undefined,
        () => undefined,
      );
      await delivery;
    };

    const drainTranscriptSignals = async (): Promise<void> => {
      while (pendingTranscriptSignals.length > 0) {
        const signal = pendingTranscriptSignals.shift();
        if (signal) {
          await emitSignal(signal);
        }
      }
    };

    const captureContext = (event: Event): void => {
      const contextSignal = readOpencodeSessionContextSignal(event);
      if (contextSignal) {
        contextUsageBySessionId.set(contextSignal.externalSessionId, contextSignal.contextUsage);
      }
    };

    const forwardEventSignals = async (event: Event): Promise<void> => {
      await drainTranscriptSignals();
      const contextSignal = readOpencodeSessionContextSignal(event);
      if (contextSignal) {
        contextUsageBySessionId.set(contextSignal.externalSessionId, contextSignal.contextUsage);
        await emitSignal(contextSignal);
      }
      if (opencodeEventInvalidatesSessions(event)) {
        await emitSignal({ type: "sessions_invalidated" });
      }
    };

    const syncEventSessions = async (sources: OpencodeRuntimeSnapshotSource[]): Promise<void> => {
      const activeSessionIds = new Set(sources.map((source) => source.externalSessionId));
      for (const session of [...eventSessions.values()]) {
        if (!activeSessionIds.has(session.externalSessionId)) {
          await releaseSessionRuntime(session, eventSessions, runtimeEventTransports);
        }
      }
      for (const source of sources) {
        const existing = eventSessions.get(source.externalSessionId);
        if (existing?.input.workingDirectory === source.workingDirectory) {
          continue;
        }
        if (existing) {
          await releaseSessionRuntime(existing, eventSessions, runtimeEventTransports);
        }
        const sessionInput = {
          repoPath: input.repoPath,
          runtimeKind: "opencode" as const,
          workingDirectory: source.workingDirectory,
          runtimePolicy: { kind: "opencode" as const },
          systemPrompt: "",
        };
        registerSession({
          sessions: eventSessions,
          runtimeEventTransports,
          createClient,
          runtimeId: input.runtimeId,
          runtimeEndpoint: input.runtimeEndpoint,
          externalSessionId: source.externalSessionId,
          sessionInput,
          client: createClient({
            runtimeEndpoint: input.runtimeEndpoint,
            workingDirectory: source.workingDirectory,
          }),
          startedAt: source.startedAt,
          emitStartedEvent: false,
          now,
          emit: (_externalSessionId, event) => {
            if (isOpencodeSessionTranscriptEvent(event)) {
              pendingTranscriptSignals.push({
                type: "transcript_event",
                externalSessionId: source.externalSessionId,
                event,
              });
            }
          },
          ...(options.logEvent ? { logEvent: options.logEvent } : {}),
        });
      }
    };

    let readSessionSourcesTail = Promise.resolve();
    const readSessionSources = (): Promise<OpencodeRuntimeSnapshotSource[]> => {
      const read = readSessionSourcesTail.then(async () => {
        requireActive();
        const sources = await listOpencodeRuntimeSnapshotSources({
          createClient,
          runtimeEndpoint: input.runtimeEndpoint,
          now,
          ...(input.directories ? { directories: input.directories } : {}),
        });
        requireActive();
        await syncEventSessions(sources);
        requireActive();
        return sources;
      });
      readSessionSourcesTail = read.then(
        () => undefined,
        () => undefined,
      );
      return read;
    };

    const observation = await observeRuntimeEvents({
      runtimeEventTransports,
      createClient,
      runtimeId: input.runtimeId,
      runtimeEndpoint: input.runtimeEndpoint,
      sessions: eventSessions,
      now,
      emit: (externalSessionId, event: AgentEvent) => {
        if (isOpencodeSessionTranscriptEvent(event)) {
          pendingTranscriptSignals.push({ type: "transcript_event", externalSessionId, event });
        }
      },
      observer: async (event) => {
        if (initializing) {
          initializationEvents.push(event);
          if (!subscribersReady) {
            eventsBeforeSubscribers.push(event);
          }
          return;
        }
        await forwardEventSignals(event);
      },
      terminalObserver: (error) =>
        emitSignal({ type: "fault", message: toOpencodeObservationFailureMessage(error) }),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(options.logEvent ? { logEvent: options.logEvent } : {}),
    });

    const initialize = async (): Promise<OpencodeRuntimeSnapshotSource[]> => {
      let initialSources = await readSessionSources();
      subscribersReady = true;
      for (const event of eventsBeforeSubscribers.splice(0)) {
        await observation.dispatch(event);
        requireActive();
      }
      const capturedEvents = initializationEvents.splice(0);
      for (const event of capturedEvents) {
        captureContext(event);
      }
      if (capturedEvents.some(opencodeEventInvalidatesSessions)) {
        initialSources = await readSessionSources();
      }
      const eventsDuringFinalRead = initializationEvents.splice(0);
      for (const event of eventsDuringFinalRead) {
        captureContext(event);
      }
      await drainTranscriptSignals();
      requireActive();
      if (eventsDuringFinalRead.some(opencodeEventInvalidatesSessions)) {
        pendingSignals.push({ type: "sessions_invalidated" });
      }
      initializing = false;
      return initialSources;
    };

    let initialSources: OpencodeRuntimeSnapshotSource[];
    try {
      initialSources = await waitForRuntimeInitialization(
        initialize(),
        input.signal,
        input.runtimeId,
      );
    } catch (error) {
      released = true;
      const cleanupFailures: unknown[] = [];
      try {
        await releaseEventSessions(eventSessions, runtimeEventTransports);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      try {
        await observation.release();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          `Failed to initialize OpenCode runtime '${input.runtimeId}' and release its partial resources.`,
        );
      }
      throw error;
    }

    const connection: OpencodeSessionRuntimeConnection = {
      readSessionSources,
      loadContextUsage: (ref) =>
        readLatestOpencodeContextUsage(
          { createClient, runtimeEndpoint: input.runtimeEndpoint },
          ref,
        ),
      replyApproval: (reply) =>
        replyToOpencodeApproval({ createClient, runtimeEndpoint: input.runtimeEndpoint }, reply),
      replyQuestion: (reply) =>
        replyToOpencodeQuestion({ createClient, runtimeEndpoint: input.runtimeEndpoint }, reply),
      startSession: (sessionInput) => controlAdapter.startSession(sessionInput),
      resumeSession: (sessionInput) => controlAdapter.resumeSession(sessionInput),
      forkSession: (sessionInput) => controlAdapter.forkSession(sessionInput),
      sendUserMessage: (messageInput) => controlAdapter.sendUserMessage(messageInput),
      updateSessionModel: (modelInput) => controlAdapter.updateSessionModel(modelInput),
      stopSession: (ref) => controlAdapter.stopSession(ref),
      releaseSession: (ref) => controlAdapter.releaseSession(ref),
    };

    const startForwarding = async (
      listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
    ): Promise<void> => {
      requireActive();
      if (forwardingListener || startingForwarding) {
        throw new Error(`OpenCode runtime '${input.runtimeId}' is already forwarding.`);
      }
      startingForwarding = true;
      try {
        while (pendingSignals.length > 0) {
          const signal = pendingSignals.shift();
          if (signal) {
            await listener(signal);
          }
          requireActive();
        }
        forwardingListener = listener;
      } finally {
        startingForwarding = false;
      }
    };

    const release = async (): Promise<void> => {
      if (released) {
        return;
      }
      released = true;
      forwardingListener = null;
      const failures: Error[] = [];
      try {
        await releaseEventSessions(eventSessions, runtimeEventTransports);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error("OpenCode cleanup failed."));
      }
      try {
        await observation.release();
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error("OpenCode observation cleanup failed."),
        );
      } finally {
        eventSessions.clear();
        pendingSignals.length = 0;
        pendingTranscriptSignals.length = 0;
        eventsBeforeSubscribers.length = 0;
        initializationEvents.length = 0;
        contextUsageBySessionId.clear();
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to release OpenCode runtime '${input.runtimeId}': ${failures
            .map((failure) => failure.message)
            .join("; ")}`,
        );
      }
    };

    return {
      connection,
      initialSources,
      initialContextUsageBySessionId: new Map(contextUsageBySessionId),
      startForwarding,
      release,
    };
  };
};
