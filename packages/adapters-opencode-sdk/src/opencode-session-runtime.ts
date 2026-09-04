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
import {
  applyOpencodeAwaitingTurnStartToRuntimeSnapshot,
  listOpencodeRuntimeSnapshotSources,
  type OpencodeRuntimeSnapshotRead,
} from "./live-session-snapshots";
import { readSessionLifecycleEvent } from "./event-stream/shared";
import type { ParsedOpencodeEvent as Event } from "./opencode-global-event-ingress";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
import {
  type OpencodeNativeApprovalReply,
  type OpencodeNativeQuestionReply,
  readLatestOpencodeContextUsage,
  replyToOpencodeApproval,
  replyToOpencodeQuestion,
} from "./opencode-session-native-operations";
import { readOpencodeSessionContextSignal } from "./opencode-agent-session-projection";
import {
  type OpencodeSessionContextUsage,
  type OpencodeSessionRuntimeSignal,
  toOpencodeObservationFailureMessage,
} from "./opencode-session-runtime-signals";
import { observeRuntimeEvents, registerSession, releaseSessionRuntime } from "./session-registry";
import type {
  OpencodeSdkAdapterOptions,
  ReadOpencodeDirectory,
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
  readonly readSessionSources: () => Promise<OpencodeRuntimeSnapshotRead>;
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
  readonly startForwarding: (
    listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
  ) => Promise<void>;
  readonly release: () => Promise<void>;
};

export type PrepareOpencodeSessionRuntime = (
  input: PrepareOpencodeSessionRuntimeInput,
) => Promise<PreparedOpencodeSessionRuntime>;

type PrepareOpencodeSessionRuntimeOptions = OpencodeSdkAdapterOptions & {
  readonly readDirectory: ReadOpencodeDirectory;
};

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
      (cause: unknown) => finish(() => reject(cause)),
    );
    if (signal.aborted) abort();
  });
};

const releaseEventSessions = async (
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  const failures: Error[] = [];
  // oxlint-disable-next-line unicorn/no-useless-spread -- cleanup awaits and must not include new sessions
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
  options: PrepareOpencodeSessionRuntimeOptions,
): PrepareOpencodeSessionRuntime => {
  const { readDirectory, ...adapterOptions } = options;
  const createClient = adapterOptions.createClient ?? buildDefaultFactory();
  const now = adapterOptions.now ?? nowIso;
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();

  return async (input) => {
    const eventSessions = new Map<string, SessionRecord>();
    const controlAdapter = new OpencodeSdkAdapter(
      {
        ...adapterOptions,
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
    const pendingSessionSignals: OpencodeSessionRuntimeSignal[] = [];
    const eventsBeforeSubscribers: Event[] = [];
    const initializationEvents: Event[] = [];
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

    const drainSessionSignals = async (): Promise<void> => {
      while (pendingSessionSignals.length > 0) {
        const signal = pendingSessionSignals.shift();
        if (signal) {
          await emitSignal(signal);
        }
      }
    };

    const belongsToRegisteredRoot = (
      externalSessionId: string,
      parentExternalSessionId?: string,
    ): boolean => {
      const eventTransport = runtimeEventTransports.get(input.runtimeId);
      let currentId: string | undefined = externalSessionId;
      let parentId = parentExternalSessionId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        if (eventSessions.has(currentId)) {
          return true;
        }
        const nextId: string | undefined =
          parentId ??
          eventTransport?.parentExternalSessionIdByChildExternalSessionId.get(currentId);
        currentId = nextId;
        parentId = undefined;
      }
      return false;
    };

    const syncEventSessions = async (
      { sources, failures }: OpencodeRuntimeSnapshotRead,
      sessionsAtReadStart: ReadonlyMap<string, SessionRecord>,
    ): Promise<void> => {
      const sourceIds = new Set([
        ...sources.map((source) => source.externalSessionId),
        ...failures.map((failure) => failure.externalSessionId),
      ]);
      for (const session of sessionsAtReadStart.values()) {
        if (
          !sourceIds.has(session.externalSessionId) &&
          eventSessions.get(session.externalSessionId) === session
        ) {
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
        const registrationInput: Parameters<typeof registerSession>[0] = {
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
          emit: (externalSessionId, event) => {
            pendingSessionSignals.push({ type: "session_event", externalSessionId, event });
          },
        };
        if (adapterOptions.logEvent) {
          registrationInput.logEvent = adapterOptions.logEvent;
        }
        registerSession(registrationInput);
      }
    };

    let readSessionSourcesTail = Promise.resolve();
    const readSessionSources = (): Promise<OpencodeRuntimeSnapshotRead> => {
      const read = readSessionSourcesTail.then(async () => {
        requireActive();
        const sessionsAtReadStart = new Map(eventSessions);
        const snapshotInput: Parameters<typeof listOpencodeRuntimeSnapshotSources>[0] = {
          createClient,
          runtimeEndpoint: input.runtimeEndpoint,
          readDirectory,
          now,
        };
        if (input.directories) {
          snapshotInput.directories = input.directories;
        }
        const result = await listOpencodeRuntimeSnapshotSources(snapshotInput);
        requireActive();
        await syncEventSessions(result, sessionsAtReadStart);
        requireActive();
        return {
          ...result,
          sources: result.sources.map((source) => {
            const withActivity = applyOpencodeAwaitingTurnStartToRuntimeSnapshot({
              sessions: eventSessions,
              runtimeId: input.runtimeId,
              snapshot: source,
            });
            if (withActivity.sessionAssociation.kind !== "unbound") {
              return withActivity;
            }
            const sessionAssociation = eventSessions.get(source.externalSessionId)?.summary
              .sessionAssociation;
            if (sessionAssociation?.kind !== "repository") {
              return withActivity;
            }
            return { ...withActivity, sessionAssociation };
          }),
        };
      });
      readSessionSourcesTail = read.then(
        () => undefined,
        () => undefined,
      );
      return read;
    };

    const forwardEventSignals = async (event: Event): Promise<void> => {
      await drainSessionSignals();
      const lifecycleEvent = readSessionLifecycleEvent(event);
      if (
        lifecycleEvent?.type === "session.deleted" &&
        belongsToRegisteredRoot(
          lifecycleEvent.externalSessionId,
          lifecycleEvent.parentExternalSessionId,
        )
      ) {
        const session = eventSessions.get(lifecycleEvent.externalSessionId);
        if (session) {
          await releaseSessionRuntime(session, eventSessions, runtimeEventTransports);
        }
        await emitSignal({
          type: "session_removed",
          externalSessionId: lifecycleEvent.externalSessionId,
        });
      }
      const contextSignal = readOpencodeSessionContextSignal(event);
      if (contextSignal && belongsToRegisteredRoot(contextSignal.externalSessionId)) {
        await emitSignal(contextSignal);
      }
    };

    const observationInput: Parameters<typeof observeRuntimeEvents>[0] = {
      runtimeEventTransports,
      createClient,
      runtimeId: input.runtimeId,
      runtimeEndpoint: input.runtimeEndpoint,
      sessions: eventSessions,
      now,
      emit: (externalSessionId, event: AgentEvent) => {
        pendingSessionSignals.push({ type: "session_event", externalSessionId, event });
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
    };
    if (input.signal) {
      observationInput.signal = input.signal;
    }
    if (adapterOptions.logEvent) {
      observationInput.logEvent = adapterOptions.logEvent;
    }
    const observation = await observeRuntimeEvents(observationInput);

    const initialize = async (): Promise<void> => {
      subscribersReady = true;
      for (const event of eventsBeforeSubscribers.splice(0)) {
        await observation.dispatch(event);
        requireActive();
      }
      initializationEvents.length = 0;
      await drainSessionSignals();
      requireActive();
      initializing = false;
    };

    try {
      await waitForRuntimeInitialization(initialize(), input.signal, input.runtimeId);
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
        pendingSessionSignals.length = 0;
        eventsBeforeSubscribers.length = 0;
        initializationEvents.length = 0;
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
      startForwarding,
      release,
    };
  };
};
