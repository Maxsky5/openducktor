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

export const removeAgentSessionsByExternalSessionIds = (
  collection: AgentSessionCollection,
  externalSessionIds: readonly string[],
): AgentSessionCollection => {
  if (externalSessionIds.length === 0) {
    return collection;
  }
  const idsToRemove = new Set(externalSessionIds);
  let changed = false;
  const next = new Map<string, AgentSessionState>();
  for (const session of listAgentSessions(collection)) {
    if (idsToRemove.has(session.externalSessionId)) {
      changed = true;
      continue;
    }
    next.set(agentSessionCollectionKey(session), session);
  }
  return changed ? next : collection;
};
