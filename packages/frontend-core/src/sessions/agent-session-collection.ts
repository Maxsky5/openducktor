import { agentSessionIdentityKey } from "../lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "../types/agent-orchestrator";

export type AgentSessionCollection = ReadonlyMap<string, AgentSessionState>;

export type AgentSessionCollectionUpdater = (
  current: AgentSessionCollection,
) => AgentSessionCollection;

export const emptyAgentSessionCollection = (): AgentSessionCollection => new Map();

export const listAgentSessions = (collection: AgentSessionCollection): AgentSessionState[] =>
  Array.from(collection.values());

/**
 * True when both sessions have the same own keys with the same values. The store runs this on each
 * commit for each session, so it compares keys without sorting them.
 */
export const areAgentSessionStatesEquivalent = (
  current: AgentSessionState,
  nextSession: AgentSessionState,
): boolean => {
  if (current === nextSession) {
    return true;
  }
  const currentEntries = Object.entries(current);
  const nextEntries = Object.entries(nextSession);
  if (currentEntries.length !== nextEntries.length) {
    return false;
  }
  const nextValues = new Map(nextEntries);
  return currentEntries.every(
    ([key, value]) => nextValues.has(key) && nextValues.get(key) === value,
  );
};

export const hasAgentSessionStateChanges = (
  current: AgentSessionState,
  nextSession: AgentSessionState,
): boolean => !areAgentSessionStatesEquivalent(current, nextSession);

export const areAgentSessionCollectionsEquivalent = (
  current: AgentSessionCollection,
  next: AgentSessionCollection,
): boolean => {
  if (current === next) {
    return true;
  }
  if (current.size !== next.size) {
    return false;
  }
  for (const [key, currentSession] of current) {
    const nextSession = next.get(key);
    if (!nextSession || !areAgentSessionStatesEquivalent(currentSession, nextSession)) {
      return false;
    }
  }
  return true;
};

export const createAgentSessionCollection = (
  sessions: Iterable<AgentSessionState>,
): AgentSessionCollection => {
  let collection = emptyAgentSessionCollection();
  for (const session of sessions) {
    collection = replaceAgentSession(collection, session);
  }
  return collection;
};

export const getAgentSession = (
  collection: AgentSessionCollection,
  identity: AgentSessionIdentity | null | undefined,
): AgentSessionState | null => {
  if (!identity) {
    return null;
  }
  return collection.get(agentSessionIdentityKey(identity)) ?? null;
};

export const replaceAgentSession = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => {
  const key = agentSessionIdentityKey(session);
  const current = collection.get(key);
  if (current === session || (current && areAgentSessionStatesEquivalent(current, session))) {
    return collection;
  }
  const next = new Map(collection);
  next.set(key, session);
  return next;
};

export const replaceAgentSessionByIdentity = (
  collection: AgentSessionCollection,
  identity: AgentSessionIdentity,
  session: AgentSessionState,
): AgentSessionCollection => {
  const currentKey = agentSessionIdentityKey(identity);
  const nextKey = agentSessionIdentityKey(session);
  const current = collection.get(nextKey);
  if (
    currentKey === nextKey &&
    (current === session || (current && areAgentSessionStatesEquivalent(current, session)))
  ) {
    return collection;
  }

  const next = new Map(collection);
  next.delete(currentKey);
  next.set(nextKey, session);
  return next;
};

export const removeAgentSession = (
  collection: AgentSessionCollection,
  identity: AgentSessionIdentity,
): AgentSessionCollection => {
  const key = agentSessionIdentityKey(identity);
  if (!collection.has(key)) {
    return collection;
  }
  const next = new Map(collection);
  next.delete(key);
  return next;
};
