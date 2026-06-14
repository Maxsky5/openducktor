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
  const next = new Map<string, AgentSessionState>();
  let changed = collection.get(key) !== session;

  for (const current of listAgentSessions(collection)) {
    if (current.externalSessionId === session.externalSessionId) {
      changed = changed || current !== session;
      continue;
    }
    next.set(agentSessionCollectionKey(current), current);
  }

  next.set(key, session);
  return changed ? next : collection;
};

export const removeAgentSessionByExternalSessionId = (
  collection: AgentSessionCollection,
  externalSessionId: string,
): AgentSessionCollection => {
  let changed = false;
  const next = new Map<string, AgentSessionState>();
  for (const session of listAgentSessions(collection)) {
    if (session.externalSessionId === externalSessionId) {
      changed = true;
      continue;
    }
    next.set(agentSessionCollectionKey(session), session);
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
