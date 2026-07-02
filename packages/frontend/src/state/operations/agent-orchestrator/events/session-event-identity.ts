import {
  type AgentEvent,
  agentSessionRefKey,
  agentSessionRefsShareRuntimeStream,
  type SessionRef,
} from "@openducktor/core";

export type StreamEventSessionRoute = {
  sessionRef: SessionRef;
  sessionKey: string;
};

const validateEventSessionRef = (
  streamSessionRef: SessionRef,
  event: AgentEvent,
  eventSessionRef: SessionRef,
): SessionRef => {
  if (eventSessionRef.externalSessionId !== event.externalSessionId) {
    throw new Error(
      `Session event '${event.type}' has externalSessionId '${event.externalSessionId}' but carries a sessionRef with externalSessionId '${eventSessionRef.externalSessionId}'.`,
    );
  }

  if (!agentSessionRefsShareRuntimeStream(eventSessionRef, streamSessionRef)) {
    throw new Error(
      `Session event '${event.type}' for '${event.externalSessionId}' belongs to repo '${eventSessionRef.repoPath}' runtime '${eventSessionRef.runtimeKind}' but arrived on repo '${streamSessionRef.repoPath}' runtime '${streamSessionRef.runtimeKind}'.`,
    );
  }

  return eventSessionRef;
};

export const sessionRefForStreamEvent = (
  streamSessionRef: SessionRef,
  event: AgentEvent,
): SessionRef => {
  if (event.sessionRef) {
    return validateEventSessionRef(streamSessionRef, event, event.sessionRef);
  }

  if (event.externalSessionId === streamSessionRef.externalSessionId) {
    return streamSessionRef;
  }

  throw new Error(
    `Session event '${event.type}' for '${event.externalSessionId}' cannot be routed from stream '${streamSessionRef.externalSessionId}' without a full session ref.`,
  );
};

export const routeStreamEventSession = (
  streamSessionRef: SessionRef,
  event: AgentEvent,
): StreamEventSessionRoute => {
  const sessionRef = sessionRefForStreamEvent(streamSessionRef, event);
  return {
    sessionRef,
    sessionKey: agentSessionRefKey(sessionRef),
  };
};
