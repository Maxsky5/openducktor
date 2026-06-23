import {
  type AgentEvent,
  type AgentSessionRef,
  agentSessionRefKey,
  agentSessionRefsShareRuntimeStream,
} from "@openducktor/core";

export type StreamEventSessionRoute = {
  sessionRef: AgentSessionRef;
  sessionKey: string;
};

const validateEventSessionRef = (
  streamSessionRef: AgentSessionRef,
  event: AgentEvent,
  eventSessionRef: AgentSessionRef,
): AgentSessionRef => {
  if (eventSessionRef.externalSessionId !== event.externalSessionId) {
    throw new Error(
      `Session event '${event.type}' routes '${event.externalSessionId}' but carries session ref '${eventSessionRef.externalSessionId}'.`,
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
  streamSessionRef: AgentSessionRef,
  event: AgentEvent,
): AgentSessionRef => {
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
  streamSessionRef: AgentSessionRef,
  event: AgentEvent,
): StreamEventSessionRoute => {
  const sessionRef = sessionRefForStreamEvent(streamSessionRef, event);
  return {
    sessionRef,
    sessionKey: agentSessionRefKey(sessionRef),
  };
};
