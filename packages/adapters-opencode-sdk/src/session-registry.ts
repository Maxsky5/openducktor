import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
import { formatAgentSessionTitle } from "@openducktor/core";
import {
  assertGlobalEventSupport,
  isRelevantSubscriberEvent,
  logStreamEvent,
  type OpencodeGlobalEventFailureScope,
  processOpencodeEvent,
  subscribeGlobalEvents,
} from "./event-stream";
import {
  readEventParentExternalSessionId,
  readEventDirectory,
  readEventSessionId,
  readSessionLifecycleEvent,
  type SubagentSessionLink,
} from "./event-stream/shared";
import type { ParsedOpencodeEvent as Event } from "./opencode-ingress";
import type {
  ClientFactory,
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";
import { cancelPendingUserMessageAdmissions } from "./user-message-admission";

export const requireSession = (
  sessions: Map<string, SessionRecord>,
  externalSessionId: string,
): SessionRecord => {
  const session = sessions.get(externalSessionId);
  if (!session) {
    throw new Error(`Unknown session: ${externalSessionId}`);
  }
  return session;
};

const resolveSubagentSessionLink = (
  sessions: Map<string, SessionRecord>,
  childExternalSessionId: string,
): SubagentSessionLink | undefined => {
  const childRuntimeIds = new Set<string>();
  for (const session of sessions.values()) {
    if (session.externalSessionId === childExternalSessionId) {
      childRuntimeIds.add(session.runtimeId);
    }
  }
  const matches: SubagentSessionLink[] = [];

  for (const session of sessions.values()) {
    const subagentCorrelationKey =
      session.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
    if (!subagentCorrelationKey) {
      continue;
    }
    if (childRuntimeIds.size > 0 && !childRuntimeIds.has(session.runtimeId)) {
      continue;
    }

    matches.push({
      parentExternalSessionId: session.externalSessionId,
      childExternalSessionId,
      subagentCorrelationKey,
    });
  }

  return matches.length === 1 ? matches[0] : undefined;
};

const processRuntimeSessionLineage = (
  eventTransport: RuntimeEventTransportRecord,
  event: Event,
): void => {
  const lifecycleEvent = readSessionLifecycleEvent(event);
  if (!lifecycleEvent) {
    return;
  }

  const {
    type: eventType,
    properties,
    info,
    externalSessionId: childExternalSessionId,
    parentExternalSessionId,
  } = lifecycleEvent;
  if (!childExternalSessionId || !info) {
    throw new Error(
      `OpenCode ${eventType} event is missing its session id or info payload; update the runtime or adapter to a supported event contract.`,
    );
  }

  if (!parentExternalSessionId) {
    const hasNonAuthoritativeParent = Boolean(readEventParentExternalSessionId(properties));
    const isConfirmedChild =
      eventTransport.parentExternalSessionIdByChildExternalSessionId.has(childExternalSessionId);
    if (!hasNonAuthoritativeParent && !isConfirmedChild) {
      return;
    }
    throw new Error(
      `OpenCode ${eventType} event for child session '${childExternalSessionId}' is missing authoritative info.parentID lineage; update the runtime or adapter to a supported event contract.`,
    );
  }

  if (eventType === "session.deleted") {
    eventTransport.parentExternalSessionIdByChildExternalSessionId.delete(childExternalSessionId);
    return;
  }

  eventTransport.parentExternalSessionIdByChildExternalSessionId.set(
    childExternalSessionId,
    parentExternalSessionId,
  );
};

const abortRuntimeEventTransport = (eventTransport: RuntimeEventTransportRecord): void => {
  eventTransport.parentExternalSessionIdByChildExternalSessionId.clear();
  eventTransport.controller.abort();
};

const toRuntimeEventFailure = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error("OpenCode runtime event projection failed.");

const reportRuntimeEventFailure = (input: {
  eventTransport: RuntimeEventTransportRecord;
  scope: OpencodeGlobalEventFailureScope;
  error: unknown;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
}): void => {
  const failure = toRuntimeEventFailure(input.error);
  const externalSessionId = input.scope.externalSessionId;
  const parentExternalSessionId =
    input.scope.parentExternalSessionId ??
    (externalSessionId
      ? input.eventTransport.parentExternalSessionIdByChildExternalSessionId.get(externalSessionId)
      : undefined);
  let subscriberId: string | undefined;
  if (externalSessionId && input.eventTransport.subscribers.has(externalSessionId)) {
    subscriberId = externalSessionId;
  } else if (
    parentExternalSessionId &&
    input.eventTransport.subscribers.has(parentExternalSessionId)
  ) {
    subscriberId = parentExternalSessionId;
  }

  if (!subscriberId) {
    const directory = input.scope.directory.trim();
    const directoryMatches = [...input.eventTransport.subscribers.values()].filter(
      (subscriber) => subscriber.input.workingDirectory.trim() === directory,
    );
    if (directoryMatches.length === 1 && directoryMatches[0]) {
      subscriberId = directoryMatches[0].externalSessionId;
    }
  }

  if (!subscriberId) {
    throw failure;
  }
  input.emit(subscriberId, {
    type: "session_error",
    externalSessionId: subscriberId,
    timestamp: input.now(),
    message: failure.message,
  });
};

const ensureRuntimeEventTransport = (input: {
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeId: string;
  runtimeEndpoint: string;
  sessions: Map<string, SessionRecord>;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): RuntimeEventTransportRecord => {
  const existingTransport = input.runtimeEventTransports.get(input.runtimeId);
  if (existingTransport) {
    if (existingTransport.runtimeEndpoint !== input.runtimeEndpoint) {
      throw new Error(
        `OpenCode runtime '${input.runtimeId}' changed endpoint while its live event transport is active.`,
      );
    }
    return existingTransport;
  }

  const streamClient = input.createClient({
    runtimeEndpoint: input.runtimeEndpoint,
  });
  assertGlobalEventSupport(streamClient);
  const controller = new AbortController();
  let resolveReady: () => void = () => undefined;
  let rejectReady: (cause: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  const streamRecord: RuntimeEventTransportRecord = {
    runtimeId: input.runtimeId,
    runtimeEndpoint: input.runtimeEndpoint,
    controller,
    dispatch: async (event) => {
      const properties = "properties" in event ? event.properties : undefined;
      const externalSessionId = readEventSessionId(event);
      const parentExternalSessionId = readEventParentExternalSessionId(properties);
      const scope: OpencodeGlobalEventFailureScope = {
        directory: readEventDirectory(event) ?? "",
        ...(() => {
          if (externalSessionId) {
            return { externalSessionId };
          }
          return {};
        })(),
        ...(() => {
          if (parentExternalSessionId) {
            return { parentExternalSessionId };
          }
          return {};
        })(),
      };
      try {
        processRuntimeSessionLineage(streamRecord, event);
      } catch (error) {
        reportRuntimeEventFailure({
          eventTransport: streamRecord,
          scope,
          error,
          now: input.now,
          emit: input.emit,
        });
        return false;
      }
      let projectionFailed = false;
      for (const subscriber of streamRecord.subscribers.values()) {
        try {
          const relevant = isRelevantSubscriberEvent(subscriber, event, {
            resolveParentExternalSessionId: (childExternalSessionId) =>
              streamRecord.parentExternalSessionIdByChildExternalSessionId.get(
                childExternalSessionId,
              ),
          });
          logStreamEvent({
            subscriber,
            event,
            relevant,
            ...(() => {
              if (input.logEvent) {
                return { logEvent: input.logEvent };
              }
              return {};
            })(),
          });
          if (!relevant) {
            continue;
          }
          processOpencodeEvent({
            externalSessionId: subscriber.externalSessionId,
            input: subscriber.input,
            session: input.sessions.get(subscriber.externalSessionId),
            event,
            now: input.now,
            emit: input.emit,
            resolveSubagentSessionLink: (childExternalSessionId) =>
              resolveSubagentSessionLink(input.sessions, childExternalSessionId),
          });
        } catch (error) {
          projectionFailed = true;
          reportRuntimeEventFailure({
            eventTransport: streamRecord,
            scope: { ...scope, externalSessionId: subscriber.externalSessionId },
            error,
            now: input.now,
            emit: input.emit,
          });
        }
      }
      return !projectionFailed;
    },
    ready,
    streamDone: Promise.resolve(),
    subscribers: new Map(),
    observers: new Set(),
    terminalObservers: new Set(),
    parentExternalSessionIdByChildExternalSessionId: new Map(),
  };
  streamRecord.streamDone = subscribeGlobalEvents({
    client: streamClient,
    controller,
    onReady: resolveReady,
    onEvent: async (event) => {
      const projected = await streamRecord.dispatch(event);
      if (!projected) {
        return;
      }
      for (const observer of streamRecord.observers) {
        await observer(event);
      }
    },
    onEventError: (error, scope) => {
      reportRuntimeEventFailure({
        eventTransport: streamRecord,
        scope,
        error,
        now: input.now,
        emit: input.emit,
      });
    },
  })
    .then(() => {
      if (!controller.signal.aborted && streamRecord.terminalObservers.size > 0) {
        throw new Error("OpenCode live event observation ended unexpectedly.");
      }
    })
    .catch(async (cause: unknown) => {
      const failure =
        cause instanceof Error ? cause : new Error("OpenCode live event observation failed.");
      rejectReady(failure);
      const message = failure.message;
      for (const subscriber of streamRecord.subscribers.values()) {
        input.emit(subscriber.externalSessionId, {
          type: "session_error",
          externalSessionId: subscriber.externalSessionId,
          timestamp: input.now(),
          message,
        });
      }
      const terminalObservers = [...streamRecord.terminalObservers];
      for (const observer of terminalObservers) {
        await observer(failure);
      }
      if (terminalObservers.length > 0) {
        throw failure;
      }
    })
    .finally(() => {
      streamRecord.parentExternalSessionIdByChildExternalSessionId.clear();
      if (input.runtimeEventTransports.get(input.runtimeId) === streamRecord) {
        input.runtimeEventTransports.delete(input.runtimeId);
      }
    });
  void streamRecord.streamDone.catch(() => undefined);
  input.runtimeEventTransports.set(input.runtimeId, streamRecord);
  return streamRecord;
};

const releaseRuntimeEventTransportIfUnused = async (
  eventTransport: RuntimeEventTransportRecord,
): Promise<void> => {
  if (
    eventTransport.subscribers.size > 0 ||
    eventTransport.observers.size > 0 ||
    eventTransport.terminalObservers.size > 0
  ) {
    return;
  }
  abortRuntimeEventTransport(eventTransport);
  await eventTransport.streamDone.catch(() => undefined);
};

export const observeRuntimeEvents = async (input: {
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeId: string;
  runtimeEndpoint: string;
  sessions: Map<string, SessionRecord>;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  observer: (event: Event) => void | Promise<void>;
  terminalObserver: (error: Error) => void | Promise<void>;
  signal?: AbortSignal;
  logEvent?: OpencodeEventLogger;
}): Promise<{ dispatch: (event: Event) => Promise<boolean>; release: () => Promise<void> }> => {
  const eventTransport = ensureRuntimeEventTransport(input);
  eventTransport.observers.add(input.observer);
  eventTransport.terminalObservers.add(input.terminalObserver);
  const waitForReady = input.signal
    ? new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          reject(
            input.signal?.reason instanceof Error
              ? input.signal.reason
              : new Error(`OpenCode runtime '${input.runtimeId}' initialization was aborted.`),
          );
        };
        if (input.signal?.aborted) {
          abort();
          return;
        }
        input.signal?.addEventListener("abort", abort, { once: true });
        void eventTransport.ready.then(resolve, reject).finally(() => {
          input.signal?.removeEventListener("abort", abort);
        });
      })
    : eventTransport.ready;
  try {
    await waitForReady;
  } catch (error) {
    eventTransport.observers.delete(input.observer);
    eventTransport.terminalObservers.delete(input.terminalObserver);
    await releaseRuntimeEventTransportIfUnused(eventTransport);
    throw error;
  }
  return {
    dispatch: eventTransport.dispatch,
    release: async () => {
      eventTransport.observers.delete(input.observer);
      eventTransport.terminalObservers.delete(input.terminalObserver);
      if (
        eventTransport.subscribers.size === 0 &&
        eventTransport.observers.size === 0 &&
        eventTransport.terminalObservers.size === 0
      ) {
        // The stream may be delivering through the host coordinator that initiated release.
        // Detach it before aborting so the same runtime id can be prepared again while the old
        // iterator finishes. Its streamDone owner observes the terminal result asynchronously.
        if (input.runtimeEventTransports.get(input.runtimeId) === eventTransport) {
          input.runtimeEventTransports.delete(input.runtimeId);
        }
        abortRuntimeEventTransport(eventTransport);
      }
    },
  };
};

export const subscribeSessionToRuntimeEvents = (input: {
  sessions: Map<string, SessionRecord>;
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeId: string;
  runtimeEndpoint: string;
  externalSessionId: string;
  sessionInput: SessionInput;
  now: () => string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): void => {
  const eventTransport = ensureRuntimeEventTransport({
    runtimeEventTransports: input.runtimeEventTransports,
    createClient: input.createClient,
    runtimeId: input.runtimeId,
    runtimeEndpoint: input.runtimeEndpoint,
    sessions: input.sessions,
    now: input.now,
    emit: input.emit,
    ...(() => {
      if (input.logEvent) {
        return { logEvent: input.logEvent };
      }
      return {};
    })(),
  });
  eventTransport.subscribers.set(input.externalSessionId, {
    externalSessionId: input.externalSessionId,
    input: input.sessionInput,
  });
};

type RegisterSessionStartEvent =
  | {
      emitStartedEvent?: true;
      startedMessage: string;
    }
  | {
      emitStartedEvent: false;
      startedMessage?: never;
    };

export const registerSession = (
  input: {
    sessions: Map<string, SessionRecord>;
    runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
    createClient: ClientFactory;
    runtimeId: string;
    runtimeEndpoint: string;
    externalSessionId: string;
    sessionInput: SessionInput;
    client: OpencodeClient;
    startedAt: string;
    subscribeToEvents?: boolean;
    now: () => string;
    emit: (externalSessionId: string, event: AgentEvent) => void;
    logEvent?: OpencodeEventLogger;
  } & RegisterSessionStartEvent,
): AgentSessionSummary => {
  const startsActive = input.emitStartedEvent !== false;
  const sessionAssociation = input.sessionInput.sessionScope ?? { kind: "unbound" };
  const title = input.sessionInput.sessionScope
    ? formatAgentSessionTitle(input.sessionInput.sessionScope)
    : undefined;
  const summary: AgentSessionSummary = {
    externalSessionId: input.externalSessionId,
    runtimeKind: input.sessionInput.runtimeKind,
    workingDirectory: input.sessionInput.workingDirectory,
    ...(() => {
      if (title) {
        return { title };
      }
      return {};
    })(),
    sessionAssociation,
    startedAt: input.startedAt,
    status: startsActive ? "running" : "idle",
  };

  input.sessions.set(input.externalSessionId, {
    summary,
    input: input.sessionInput,
    client: input.client,
    externalSessionId: input.externalSessionId,
    runtimeId: input.runtimeId,
    streamTurnStatus: "idle",
    isSendingUserMessage: false,
    isAwaitingRuntimeTurnStart: false,
    activeAssistantMessageId: null,
    completedAssistantMessageIds: new Set<string>(),
    pendingCompletedAssistantMessageIds: new Set<string>(),
    emittedAssistantMessageIds: new Set<string>(),
    emittedUserMessageSignatures: new Map<string, string>(),
    emittedUserMessageStates: new Map(),
    pendingUserMessageAdmissions: new Map(),
    pendingQueuedUserMessages: [],
    partsById: new Map(),
    partIdsByMessageId: new Map(),
    messageRoleById: new Map(),
    messageMetadataById: new Map(),
    compactionMessageIds: new Set(),
    pendingDeltasByPartId: new Map(),
    subagentCorrelationKeyByPartId: new Map(),
    subagentCorrelationKeyByExternalSessionId: new Map(),
    subagentPartIdByCorrelationKey: new Map(),
    subagentPartIdByExternalSessionId: new Map(),
    pendingSubagentCorrelationKeysBySignature: new Map(),
    pendingSubagentCorrelationKeys: [],
    pendingSubagentSessionsByExternalSessionId: new Map(),
    pendingSubagentPartEmissionsByExternalSessionId: new Map(),
    pendingSubagentInputEventsByExternalSessionId: new Map(),
    pendingBackgroundTaskResultsByExternalSessionId: new Map(),
  });

  if (input.subscribeToEvents !== false) {
    try {
      subscribeSessionToRuntimeEvents({
        sessions: input.sessions,
        runtimeEventTransports: input.runtimeEventTransports,
        createClient: input.createClient,
        runtimeId: input.runtimeId,
        runtimeEndpoint: input.runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput: input.sessionInput,
        now: input.now,
        emit: input.emit,
        ...(() => {
          if (input.logEvent) {
            return { logEvent: input.logEvent };
          }
          return {};
        })(),
      });
    } catch (error) {
      input.sessions.delete(input.externalSessionId);
      throw error;
    }
  }

  if (input.emitStartedEvent !== false) {
    input.emit(input.externalSessionId, {
      type: "session_started",
      externalSessionId: input.externalSessionId,
      timestamp: input.now(),
      message: input.startedMessage,
    });
  }

  return summary;
};

export const releaseSessionRuntime = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  cancelPendingUserMessageAdmissions(
    session,
    new Error(`OpenCode session '${session.externalSessionId}' was released.`),
  );
  sessions.delete(session.summary.externalSessionId);
  const eventTransport = runtimeEventTransports.get(session.runtimeId);
  if (!eventTransport) {
    return;
  }
  eventTransport.subscribers.delete(session.summary.externalSessionId);
  await releaseRuntimeEventTransportIfUnused(eventTransport);
};

export const stopSessionRuntime = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  await session.client.session.abort({
    directory: session.input.workingDirectory,
    sessionID: session.externalSessionId,
  });

  await releaseSessionRuntime(session, sessions, runtimeEventTransports);
};
