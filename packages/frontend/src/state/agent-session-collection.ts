import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type AgentSessionCollection = ReadonlyMap<string, AgentSessionState>;

export type AgentSessionCollectionUpdater =
  | AgentSessionCollection
  | ((current: AgentSessionCollection) => AgentSessionCollection);

export const agentSessionCollectionKey = (identity: AgentSessionIdentity): string =>
  agentSessionIdentityKey(identity);

export const emptyAgentSessionCollection = (): AgentSessionCollection => new Map();

export const listAgentSessions = (collection: AgentSessionCollection): AgentSessionState[] =>
  Array.from(collection.values());

export const hasAgentSessionStateChanges = (
  current: AgentSessionState,
  nextSession: AgentSessionState,
): boolean => {
  for (const key of Object.keys(nextSession) as Array<keyof AgentSessionState>) {
    if (nextSession[key] !== current[key]) {
      return true;
    }
  }
  return false;
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
  return collection.get(agentSessionCollectionKey(identity)) ?? null;
};

export const replaceAgentSession = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => {
  const key = agentSessionCollectionKey(session);
  if (collection.get(key) === session) {
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
  const currentKey = agentSessionCollectionKey(identity);
  const nextKey = agentSessionCollectionKey(session);
  if (currentKey === nextKey && collection.get(nextKey) === session) {
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
  const key = agentSessionCollectionKey(identity);
  if (!collection.has(key)) {
    return collection;
  }
  const next = new Map(collection);
  next.delete(key);
  return next;
};

export const removeAgentSessions = (
  collection: AgentSessionCollection,
  identities: readonly AgentSessionIdentity[],
): AgentSessionCollection => {
  if (identities.length === 0) {
    return collection;
  }
  const keysToRemove = new Set(identities.map(agentSessionCollectionKey));
  let changed = false;
  const next = new Map<string, AgentSessionState>();
  for (const session of listAgentSessions(collection)) {
    const key = agentSessionCollectionKey(session);
    if (keysToRemove.has(key)) {
      changed = true;
      continue;
    }
    next.set(key, session);
  }
  return changed ? next : collection;
};
