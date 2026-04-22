import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
import {
  assertGlobalEventSupport,
  isRelevantSubscriberEvent,
  logStreamEvent,
  processOpencodeEvent,
  subscribeGlobalEvents,
} from "./event-stream";
import type {
  ClientFactory,
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";

export const hasSession = (sessions: Map<string, SessionRecord>, sessionId: string): boolean => {
  return sessions.has(sessionId);
};

export const requireSession = (
  sessions: Map<string, SessionRecord>,
  sessionId: string,
): SessionRecord => {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
};

const ensureRuntimeEventTransport = (input: {
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeEndpoint: string;
  sessions: Map<string, SessionRecord>;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): RuntimeEventTransportRecord => {
  const eventTransportKey = input.runtimeEndpoint;
  const existingTransport = input.runtimeEventTransports.get(eventTransportKey);
  if (existingTransport) {
    return existingTransport;
  }

  const streamClient = input.createClient({
    runtimeEndpoint: input.runtimeEndpoint,
  });
  assertGlobalEventSupport(streamClient);
  const controller = new AbortController();
  const streamRecord: RuntimeEventTransportRecord = {
    key: eventTransportKey,
    runtimeEndpoint: input.runtimeEndpoint,
    controller,
    streamDone: Promise.resolve(),
    subscribers: new Map(),
  };
  streamRecord.streamDone = subscribeGlobalEvents({
    client: streamClient,
    controller,
    onEvent: (event) => {
      for (const subscriber of streamRecord.subscribers.values()) {
        const relevant = isRelevantSubscriberEvent(subscriber, event);
        logStreamEvent({
          subscriber,
          event,
          relevant,
          ...(input.logEvent ? { logEvent: input.logEvent } : {}),
        });
        if (!relevant) {
          continue;
        }
        processOpencodeEvent({
          context: {
            sessionId: subscriber.sessionId,
            externalSessionId: subscriber.externalSessionId,
            input: subscriber.input,
          },
          event,
          now: input.now,
          emit: input.emit,
          getSession: (sessionId) => input.sessions.get(sessionId),
        });
      }
    },
  })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Event stream failed";
      for (const subscriber of streamRecord.subscribers.values()) {
        input.emit(subscriber.sessionId, {
          type: "session_error",
          sessionId: subscriber.sessionId,
          timestamp: input.now(),
          message,
        });
      }
    })
    .finally(() => {
      input.runtimeEventTransports.delete(eventTransportKey);
    });
  input.runtimeEventTransports.set(eventTransportKey, streamRecord);
  return streamRecord;
};

export const attachSessionToRuntimeEvents = (input: {
  sessions: Map<string, SessionRecord>;
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeEndpoint: string;
  sessionId: string;
  externalSessionId: string;
  sessionInput: SessionInput;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): void => {
  const eventTransport = ensureRuntimeEventTransport({
    runtimeEventTransports: input.runtimeEventTransports,
    createClient: input.createClient,
    runtimeEndpoint: input.runtimeEndpoint,
    sessions: input.sessions,
    now: input.now,
    emit: input.emit,
    ...(input.logEvent ? { logEvent: input.logEvent } : {}),
  });
  eventTransport.subscribers.set(input.sessionId, {
    sessionId: input.sessionId,
    externalSessionId: input.externalSessionId,
    input: input.sessionInput,
  });
};

export const registerSession = (input: {
  sessions: Map<string, SessionRecord>;
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeEndpoint: string;
  sessionId: string;
  externalSessionId: string;
  sessionInput: SessionInput;
  client: OpencodeClient;
  startedAt: string;
  startedMessage: string;
  emitStartedEvent?: boolean;
  subscribeToEvents?: boolean;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): AgentSessionSummary => {
  const summary: AgentSessionSummary = {
    sessionId: input.sessionId,
    externalSessionId: input.externalSessionId,
    role: input.sessionInput.role,
    scenario: input.sessionInput.scenario,
    startedAt: input.startedAt,
    status: "running",
  };

  const eventTransportKey = input.runtimeEndpoint;

  input.sessions.set(input.sessionId, {
    summary,
    input: input.sessionInput,
    client: input.client,
    externalSessionId: input.externalSessionId,
    eventTransportKey,
    hasIdleSinceActivity: false,
    activeAssistantMessageId: null,
    completedAssistantMessageIds: new Set<string>(),
    emittedAssistantMessageIds: new Set<string>(),
    emittedUserMessageSignatures: new Map<string, string>(),
    emittedUserMessageStates: new Map(),
    pendingQueuedUserMessages: [],
    partsById: new Map(),
    messageRoleById: new Map(),
    messageMetadataById: new Map(),
    pendingDeltasByPartId: new Map(),
    subagentCorrelationKeyByPartId: new Map(),
    subagentCorrelationKeyBySessionId: new Map(),
    pendingSubagentCorrelationKeysBySignature: new Map(),
    pendingSubagentCorrelationKeys: [],
  });

  if (input.subscribeToEvents !== false) {
    attachSessionToRuntimeEvents({
      sessions: input.sessions,
      runtimeEventTransports: input.runtimeEventTransports,
      createClient: input.createClient,
      runtimeEndpoint: input.runtimeEndpoint,
      sessionId: input.sessionId,
      externalSessionId: input.externalSessionId,
      sessionInput: input.sessionInput,
      now: input.now,
      emit: input.emit,
      ...(input.logEvent ? { logEvent: input.logEvent } : {}),
    });
  }

  if (input.emitStartedEvent !== false) {
    input.emit(input.sessionId, {
      type: "session_started",
      sessionId: input.sessionId,
      timestamp: input.now(),
      message: input.startedMessage,
    });
  }

  return summary;
};

export const clearWorkflowToolCacheForDirectory = (
  sessions: Map<string, SessionRecord>,
  workingDirectory: string,
): void => {
  for (const session of sessions.values()) {
    if (session.input.workingDirectory === workingDirectory) {
      delete session.workflowToolSelectionCache;
      delete session.workflowToolSelectionCachedAt;
      delete session.workflowToolSelectionCacheModelKey;
    }
  }
};

export const stopSessionRuntime = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  try {
    await session.client.session.abort({
      directory: session.input.workingDirectory,
      sessionID: session.externalSessionId,
    });
  } catch (abortError) {
    void abortError;
  }

  sessions.delete(session.summary.sessionId);
  const eventTransport = runtimeEventTransports.get(session.eventTransportKey);
  if (!eventTransport) {
    return;
  }
  eventTransport.subscribers.delete(session.summary.sessionId);
  if (eventTransport.subscribers.size > 0) {
    return;
  }
  eventTransport.controller.abort();
  await eventTransport.streamDone.catch(() => undefined);
};
