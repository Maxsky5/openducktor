import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type AgentSessionCollection = Record<string, AgentSessionState>;

export type AgentSessionCollectionUpdater =
  | AgentSessionCollection
  | ((current: AgentSessionCollection) => AgentSessionCollection);

export const agentSessionCollectionKey = (identity: AgentSessionIdentity): string =>
  agentSessionIdentityKey(identity);

export const emptyAgentSessionCollection = (): AgentSessionCollection => ({});

export const listAgentSessions = (collection: AgentSessionCollection): AgentSessionState[] =>
  Object.values(collection);

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
  return collection[agentSessionCollectionKey(identity)] ?? null;
};

export const getAgentSessionByExternalSessionId = (
  collection: AgentSessionCollection,
  externalSessionId: string,
): AgentSessionState | null => {
  const matches = listAgentSessions(collection).filter(
    (session) => session.externalSessionId === externalSessionId,
  );
  if (matches.length > 1) {
    throw new Error(
      `Session '${externalSessionId}' is duplicated in the local session collection.`,
    );
  }
  return matches[0] ?? null;
};

export const replaceAgentSession = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => {
  const key = agentSessionCollectionKey(session);
  const next: AgentSessionCollection = {};
  let changed = collection[key] !== session;

  for (const current of listAgentSessions(collection)) {
    if (current.externalSessionId === session.externalSessionId) {
      changed = changed || current !== session;
      continue;
    }
    next[agentSessionCollectionKey(current)] = current;
  }

  next[key] = session;
  return changed ? next : collection;
};

export const removeAgentSessionByExternalSessionId = (
  collection: AgentSessionCollection,
  externalSessionId: string,
): AgentSessionCollection => {
  let changed = false;
  const next: AgentSessionCollection = {};
  for (const session of listAgentSessions(collection)) {
    if (session.externalSessionId === externalSessionId) {
      changed = true;
      continue;
    }
    next[agentSessionCollectionKey(session)] = session;
  }
  return changed ? next : collection;
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
  const next: AgentSessionCollection = {};
  for (const session of listAgentSessions(collection)) {
    if (idsToRemove.has(session.externalSessionId)) {
      changed = true;
      continue;
    }
    next[agentSessionCollectionKey(session)] = session;
  }
  return changed ? next : collection;
};
