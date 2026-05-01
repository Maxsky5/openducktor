import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
import {
  assertGlobalEventSupport,
  isRelevantSubscriberEvent,
  logStreamEvent,
  processOpencodeEvent,
  subscribeGlobalEvents,
} from "./event-stream";
import type { SubagentSessionLink } from "./event-stream/shared";
import type {
  ClientFactory,
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";

export const hasSession = (
  sessions: Map<string, SessionRecord>,
  externalSessionId: string,
): boolean => {
  return sessions.has(externalSessionId);
};

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
  const childTransportKeys = new Set<string>();
  for (const session of sessions.values()) {
    if (session.externalSessionId === childExternalSessionId) {
      childTransportKeys.add(session.eventTransportKey);
    }
  }
  const matches: SubagentSessionLink[] = [];

  for (const session of sessions.values()) {
    const subagentCorrelationKey =
      session.subagentCorrelationKeyByExternalSessionId.get(childExternalSessionId);
    if (!subagentCorrelationKey) {
      continue;
    }
    if (childTransportKeys.size > 0 && !childTransportKeys.has(session.eventTransportKey)) {
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
        const relevant = isRelevantSubscriberEvent(subscriber, event, {
          isKnownChildExternalSessionId: (externalSessionId) =>
            input.sessions
              .get(subscriber.externalSessionId)
              ?.subagentCorrelationKeyByExternalSessionId.has(externalSessionId) ?? false,
        });
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
            externalSessionId: subscriber.externalSessionId,
            input: subscriber.input,
          },
          event,
          now: input.now,
          emit: input.emit,
          getSession: (sessionId) => input.sessions.get(sessionId),
          resolveSubagentSessionLink: (childExternalSessionId) =>
            resolveSubagentSessionLink(input.sessions, childExternalSessionId),
        });
      }
    },
  })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Event stream failed";
      for (const subscriber of streamRecord.subscribers.values()) {
        input.emit(subscriber.externalSessionId, {
          type: "session_error",
          externalSessionId: subscriber.externalSessionId,
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
  externalSessionId: string;
  sessionInput: SessionInput;
  now: () => string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
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
  eventTransport.subscribers.set(input.externalSessionId, {
    externalSessionId: input.externalSessionId,
    input: input.sessionInput,
  });
};

export const registerSession = (input: {
  sessions: Map<string, SessionRecord>;
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  createClient: ClientFactory;
  runtimeEndpoint: string;
  externalSessionId: string;
  sessionInput: SessionInput;
  client: OpencodeClient;
  startedAt: string;
  startedMessage: string;
  emitStartedEvent?: boolean;
  subscribeToEvents?: boolean;
  now: () => string;
  emit: (externalSessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): AgentSessionSummary => {
  const summary: AgentSessionSummary = {
    externalSessionId: input.externalSessionId,
    role: input.sessionInput.role,
    startedAt: input.startedAt,
    status: "running",
  };

  const eventTransportKey = input.runtimeEndpoint;

  input.sessions.set(input.externalSessionId, {
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
    subagentCorrelationKeyByExternalSessionId: new Map(),
    pendingSubagentCorrelationKeysBySignature: new Map(),
    pendingSubagentCorrelationKeys: [],
    pendingSubagentSessionsByExternalSessionId: new Map(),
    pendingSubagentPartEmissionsByExternalSessionId: new Map(),
    pendingSubagentInputEventsByExternalSessionId: new Map(),
  });

  if (input.subscribeToEvents !== false) {
    try {
      attachSessionToRuntimeEvents({
        sessions: input.sessions,
        runtimeEventTransports: input.runtimeEventTransports,
        createClient: input.createClient,
        runtimeEndpoint: input.runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput: input.sessionInput,
        now: input.now,
        emit: input.emit,
        ...(input.logEvent ? { logEvent: input.logEvent } : {}),
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

export const clearWorkflowToolCacheForDirectory = (
  sessions: Map<string, SessionRecord>,
  workingDirectory: string,
): void => {
  for (const session of sessions.values()) {
    if (session.input.workingDirectory === workingDirectory) {
      delete session.workflowToolSelectionCache;
      delete session.workflowToolSelectionCachedAt;
    }
  }
};

const releaseSessionRuntimeAttachment = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  sessions.delete(session.summary.externalSessionId);
  const eventTransport = runtimeEventTransports.get(session.eventTransportKey);
  if (!eventTransport) {
    return;
  }
  eventTransport.subscribers.delete(session.summary.externalSessionId);
  if (eventTransport.subscribers.size > 0) {
    return;
  }
  eventTransport.controller.abort();
  await eventTransport.streamDone.catch(() => undefined);
};

export const detachSessionRuntime = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  await releaseSessionRuntimeAttachment(session, sessions, runtimeEventTransports);
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

  await releaseSessionRuntimeAttachment(session, sessions, runtimeEventTransports);
};
