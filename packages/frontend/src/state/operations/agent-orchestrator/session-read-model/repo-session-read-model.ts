import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
} from "@openducktor/core";
import { toMissingAgentSessionPresenceSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  getAgentSessionByExternalSessionId,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { projectRepoSessionPresenceSnapshot } from "../lifecycle/session-presence";
import { normalizeWorkingDirectory } from "../support/core";
import { fromPersistedSessionRecord } from "../support/persistence";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";

type TaskSessionRecord = {
  taskId: string;
  record: AgentSessionRecord;
};

export type TaskSessionRecords = {
  id: string;
  agentSessions: AgentSessionRecord[];
};

export type RepoRuntimeSessionPresenceRead = {
  snapshotsBySessionKey: Map<string, AgentSessionPresenceSnapshot>;
};

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessions: AgentSessionRef[];
  initialHistorySessions: AgentSessionState[];
};

const collectTaskSessionRecords = (tasks: TaskSessionRecords[]): TaskSessionRecord[] => {
  const records: TaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of task.agentSessions) {
      records.push({ taskId: task.id, record });
    }
  }
  return records;
};

const collectPersistedSessionKeys = (records: TaskSessionRecord[]): Set<string> =>
  new Set(records.map(({ record }) => agentSessionIdentityKey(record)));

const shouldKeepLocalSession = (
  session: AgentSessionState,
  persistedSessionKeys: Set<string>,
): boolean => {
  return (
    !persistedSessionKeys.has(agentSessionIdentityKey(session)) && session.status === "starting"
  );
};

const selectLocalSessions = (
  currentSessionCollection: AgentSessionCollection,
  taskSessionRecords: TaskSessionRecord[],
): AgentSessionCollection => {
  const persistedSessionKeys = collectPersistedSessionKeys(taskSessionRecords);
  let localSessions = emptyAgentSessionCollection();
  for (const session of listAgentSessions(currentSessionCollection)) {
    if (shouldKeepLocalSession(session, persistedSessionKeys)) {
      localSessions = replaceAgentSession(localSessions, session);
    }
  }
  return localSessions;
};

const toPersistedSessionView = ({
  taskId,
  record,
  current,
}: {
  taskId: string;
  record: AgentSessionRecord;
  current: AgentSessionState | undefined;
}): AgentSessionState => {
  const persisted = fromPersistedSessionRecord(record, taskId);
  if (!current) {
    return persisted;
  }
  return {
    ...current,
    taskId: persisted.taskId,
    runtimeKind: persisted.runtimeKind,
    role: persisted.role,
    startedAt: persisted.startedAt,
    workingDirectory: persisted.workingDirectory,
    selectedModel: persisted.selectedModel,
  };
};

const toPersistedSessionRef = ({
  repoPath,
  record,
}: {
  repoPath: string;
  record: AgentSessionRecord;
}): AgentSessionRef => ({
  repoPath,
  runtimeKind: readPersistedRuntimeKind(record),
  workingDirectory: record.workingDirectory,
  externalSessionId: record.externalSessionId,
});

export const readRepoRuntimeSessionPresence = async ({
  repoPath,
  tasks,
  listSessionPresence,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  listSessionPresence: AgentEnginePort["listSessionPresence"];
}): Promise<RepoRuntimeSessionPresenceRead> => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const { record } of taskSessionRecords) {
    const runtimeKind = readPersistedRuntimeKind(record);
    const directory = normalizeWorkingDirectory(record.workingDirectory);
    if (directory.length === 0) {
      throw new Error(
        `Session '${record.externalSessionId}' is missing a working directory for runtime '${runtimeKind}'.`,
      );
    }
    const directories = directoriesByRuntimeKind.get(runtimeKind) ?? new Set<string>();
    directories.add(directory);
    directoriesByRuntimeKind.set(runtimeKind, directories);
  }

  const snapshotsBySessionKey = new Map<string, AgentSessionPresenceSnapshot>();
  await Promise.all(
    Array.from(directoriesByRuntimeKind.entries()).map(async ([runtimeKind, directorySet]) => {
      const directories = Array.from(directorySet).sort();
      const snapshots = await listSessionPresence({ repoPath, runtimeKind, directories });
      for (const snapshot of snapshots) {
        snapshotsBySessionKey.set(agentSessionIdentityKey(snapshot.ref), snapshot);
      }
    }),
  );

  return { snapshotsBySessionKey };
};

export const buildRepoSessionReadModel = ({
  repoPath,
  tasks,
  currentSessionCollection,
  runtimePresence,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionCollection?: AgentSessionCollection;
  runtimePresence: RepoRuntimeSessionPresenceRead;
}): RepoSessionReadModel => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const currentSessions = currentSessionCollection ?? emptyAgentSessionCollection();
  let sessionCollection = selectLocalSessions(currentSessions, taskSessionRecords);
  const liveSessions: AgentSessionRef[] = [];
  const initialHistorySessions: AgentSessionState[] = [];

  for (const { taskId, record } of taskSessionRecords) {
    const ref = toPersistedSessionRef({ repoPath, record });
    const sessionKey = agentSessionIdentityKey(ref);
    const current = getAgentSession(currentSessions, record) ?? undefined;
    const snapshot =
      runtimePresence.snapshotsBySessionKey.get(sessionKey) ??
      toMissingAgentSessionPresenceSnapshot(ref);
    const persistedSessionView = toPersistedSessionView({
      taskId,
      record,
      current,
    });
    const presenceProjection = projectRepoSessionPresenceSnapshot(persistedSessionView, snapshot);
    const { session } = presenceProjection;
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (presenceProjection.shouldListen) {
      liveSessions.push(toRuntimeSessionRef(repoPath, session));
      if (session.historyLoadState === "not_requested") {
        initialHistorySessions.push(session);
      }
    }
  }

  return { sessionCollection, liveSessions, initialHistorySessions };
};

export const selectRepoSessionHistoryTargets = ({
  readModel,
  targetExternalSessionId,
}: {
  readModel: RepoSessionReadModel;
  targetExternalSessionId?: string | null | undefined;
}): AgentSessionState[] => {
  const requestedSessionId = targetExternalSessionId?.trim();
  if (!requestedSessionId) {
    return readModel.initialHistorySessions;
  }

  const session = getAgentSessionByExternalSessionId(
    readModel.sessionCollection,
    requestedSessionId,
  );
  if (!session) {
    throw new Error(`Cannot load history for unknown session '${requestedSessionId}'.`);
  }
  return [session];
};
