import type { Event, OpencodeClient, Session } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import {
  assertGlobalEventSupport,
  isRelevantSubscriberEvent,
  logStreamEvent,
  processOpencodeEvent,
  subscribeGlobalEvents,
} from "./event-stream";
import {
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  type SubagentSessionLink,
} from "./event-stream/shared";
import type {
  ClientFactory,
  EventStreamSubscriber,
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";

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

const PARENT_CHILD_LOOKUP_EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "permission.asked",
  "permission.v2.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
]);

const shouldResolveParentlessChildEvent = (
  subscriber: EventStreamSubscriber,
  event: Event,
): string | null => {
  if (!PARENT_CHILD_LOOKUP_EVENT_TYPES.has(event.type)) {
    return null;
  }

  const childExternalSessionId = readEventSessionId(event);
  if (
    !childExternalSessionId ||
    childExternalSessionId === subscriber.externalSessionId ||
    readEventParentExternalSessionId("properties" in event ? event.properties : undefined)
  ) {
    return null;
  }

  const eventDirectory = readEventDirectory(event);
  if (eventDirectory && eventDirectory !== subscriber.input.workingDirectory) {
    return null;
  }

  return childExternalSessionId;
};

const listChildSessions = async (
  client: OpencodeClient,
  subscriber: EventStreamSubscriber,
): Promise<Session[]> => {
  const childrenApi = (client as OpencodeClient & { session?: { children?: unknown } }).session
    ?.children;
  if (typeof childrenApi !== "function") {
    throw new Error(
      "OpenCode SDK does not expose session.children(); cannot resolve parentless child session events.",
    );
  }

  const response = await client.session.children({
    directory: subscriber.input.workingDirectory,
    sessionID: subscriber.externalSessionId,
  });
  return unwrapData(response, `list child sessions for ${subscriber.externalSessionId}`);
};

const hasConfirmedChildSession = (
  children: Session[],
  subscriber: EventStreamSubscriber,
  childExternalSessionId: string,
): boolean => {
  return children.some(
    (child) =>
      child.id === childExternalSessionId &&
      readEventParentExternalSessionId(child) === subscriber.externalSessionId,
  );
};

const withParentExternalSessionId = (event: Event, parentExternalSessionId: string): Event => {
  const properties =
    "properties" in event && event.properties && typeof event.properties === "object"
      ? (event.properties as Record<string, unknown>)
      : {};
  const info =
    properties.info && typeof properties.info === "object"
      ? (properties.info as Record<string, unknown>)
      : {};

  return {
    ...event,
    properties: {
      ...properties,
      parentID: parentExternalSessionId,
      info: {
        ...info,
        parentID: parentExternalSessionId,
      },
    },
  } as Event;
};

const resolveParentlessChildEvent = async (input: {
  client: OpencodeClient;
  subscriber: EventStreamSubscriber;
  event: Event;
}): Promise<Event | null> => {
  const childExternalSessionId = shouldResolveParentlessChildEvent(input.subscriber, input.event);
  if (!childExternalSessionId) {
    return null;
  }

  const children = await listChildSessions(input.client, input.subscriber);
  if (!hasConfirmedChildSession(children, input.subscriber, childExternalSessionId)) {
    return null;
  }

  return withParentExternalSessionId(input.event, input.subscriber.externalSessionId);
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
    return existingTransport;
  }

  const streamClient = input.createClient({
    runtimeEndpoint: input.runtimeEndpoint,
  });
  assertGlobalEventSupport(streamClient);
  const controller = new AbortController();
  const streamRecord: RuntimeEventTransportRecord = {
    runtimeId: input.runtimeId,
    runtimeEndpoint: input.runtimeEndpoint,
    controller,
    streamDone: Promise.resolve(),
    subscribers: new Map(),
  };
  streamRecord.streamDone = subscribeGlobalEvents({
    client: streamClient,
    controller,
    onEvent: async (event) => {
      for (const subscriber of streamRecord.subscribers.values()) {
        let eventForSubscriber = event;
        let relevant = isRelevantSubscriberEvent(subscriber, event, {
          isKnownChildExternalSessionId: (externalSessionId) => {
            const session = input.sessions.get(subscriber.externalSessionId);
            return (
              (session?.subagentCorrelationKeyByExternalSessionId.has(externalSessionId) ??
                false) ||
              (session?.pendingSubagentSessionsByExternalSessionId.has(externalSessionId) ?? false)
            );
          },
        });
        if (!relevant) {
          const parentLinkedEvent = await resolveParentlessChildEvent({
            client: streamClient,
            subscriber,
            event,
          });
          if (parentLinkedEvent) {
            eventForSubscriber = parentLinkedEvent;
            relevant = true;
          }
        }
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
          event: eventForSubscriber,
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
      input.runtimeEventTransports.delete(input.runtimeId);
    });
  input.runtimeEventTransports.set(input.runtimeId, streamRecord);
  return streamRecord;
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
    ...(input.logEvent ? { logEvent: input.logEvent } : {}),
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
  const summary: AgentSessionSummary = {
    externalSessionId: input.externalSessionId,
    runtimeKind: input.sessionInput.runtimeKind,
    workingDirectory: input.sessionInput.workingDirectory,
    ...(input.sessionInput.role
      ? {
          title: formatWorkflowAgentSessionTitle(
            input.sessionInput.role,
            input.sessionInput.taskId,
          ),
        }
      : {}),
    role: input.sessionInput.role,
    startedAt: input.startedAt,
    status: "running",
  };

  input.sessions.set(input.externalSessionId, {
    summary,
    input: input.sessionInput,
    client: input.client,
    externalSessionId: input.externalSessionId,
    runtimeId: input.runtimeId,
    streamTurnStatus: "active",
    isSendingUserMessage: false,
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
    subagentPartIdByCorrelationKey: new Map(),
    subagentPartIdByExternalSessionId: new Map(),
    pendingSubagentCorrelationKeysBySignature: new Map(),
    pendingSubagentCorrelationKeys: [],
    pendingSubagentSessionsByExternalSessionId: new Map(),
    pendingSubagentPartEmissionsByExternalSessionId: new Map(),
    pendingSubagentInputEventsByExternalSessionId: new Map(),
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

export const releaseSessionRuntime = async (
  session: SessionRecord,
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  sessions.delete(session.summary.externalSessionId);
  const eventTransport = runtimeEventTransports.get(session.runtimeId);
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
