import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
} from "@openducktor/core";
import { toPersistedOnlyAgentSessionPresenceSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  applyAgentSessionPresenceSnapshotToSession,
  shouldListenToAgentSessionPresenceSnapshot,
} from "../lifecycle/session-presence";
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
  sessionsById: Record<string, AgentSessionState>;
  liveSessions: AgentSessionRef[];
};

const toSessionKey = (
  runtimeKind: RuntimeKind,
  workingDirectory: string,
  externalSessionId: string,
): string => `${runtimeKind}::${normalizeWorkingDirectory(workingDirectory)}::${externalSessionId}`;

const collectTaskSessionRecords = (tasks: TaskSessionRecords[]): TaskSessionRecord[] => {
  const records: TaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of task.agentSessions) {
      records.push({ taskId: task.id, record });
    }
  }
  return records;
};

const collectPersistedSessionIds = (records: TaskSessionRecord[]): Set<string> =>
  new Set(records.map(({ record }) => record.externalSessionId));

const shouldKeepLocalSession = (
  session: AgentSessionState,
  persistedSessionIds: Set<string>,
): boolean => {
  return !persistedSessionIds.has(session.externalSessionId) && session.status === "starting";
};

const selectLocalSessions = (
  currentSessionsById: Record<string, AgentSessionState>,
  taskSessionRecords: TaskSessionRecord[],
): Record<string, AgentSessionState> => {
  const persistedSessionIds = collectPersistedSessionIds(taskSessionRecords);
  return Object.fromEntries(
    Object.entries(currentSessionsById).filter(([, session]) =>
      shouldKeepLocalSession(session, persistedSessionIds),
    ),
  );
};

const toPersistedSessionView = ({
  repoPath,
  taskId,
  record,
  current,
}: {
  repoPath: string;
  taskId: string;
  record: AgentSessionRecord;
  current: AgentSessionState | undefined;
}): AgentSessionState => {
  const persisted = fromPersistedSessionRecord(record, taskId, repoPath);
  const runtimeKind = readPersistedRuntimeKind(record);
  if (!current) {
    return persisted;
  }
  return {
    ...current,
    taskId,
    repoPath,
    runtimeKind,
    role: record.role,
    startedAt: record.startedAt,
    workingDirectory: record.workingDirectory,
    selectedModel: persisted.selectedModel ?? current.selectedModel,
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
        snapshotsBySessionKey.set(
          toSessionKey(
            snapshot.ref.runtimeKind,
            snapshot.ref.workingDirectory,
            snapshot.ref.externalSessionId,
          ),
          snapshot,
        );
      }
    }),
  );

  return { snapshotsBySessionKey };
};

export const buildRepoSessionReadModel = ({
  repoPath,
  tasks,
  currentSessionsById = {},
  runtimePresence,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionsById?: Record<string, AgentSessionState>;
  runtimePresence: RepoRuntimeSessionPresenceRead;
}): RepoSessionReadModel => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const sessionsById = { ...selectLocalSessions(currentSessionsById, taskSessionRecords) };
  const liveSessions: AgentSessionRef[] = [];

  for (const { taskId, record } of taskSessionRecords) {
    const ref = toPersistedSessionRef({ repoPath, record });
    const sessionKey = toSessionKey(ref.runtimeKind, ref.workingDirectory, ref.externalSessionId);
    const current = currentSessionsById[record.externalSessionId];
    const snapshot =
      runtimePresence.snapshotsBySessionKey.get(sessionKey) ??
      toPersistedOnlyAgentSessionPresenceSnapshot({
        ref,
        reason: "No live runtime session found for persisted session.",
      });
    const baseSession = toPersistedSessionView({
      repoPath,
      taskId,
      record,
      current,
    });
    const session = applyAgentSessionPresenceSnapshotToSession(baseSession, snapshot);
    sessionsById[record.externalSessionId] = session;

    if (shouldListenToAgentSessionPresenceSnapshot(snapshot)) {
      liveSessions.push(toRuntimeSessionRef(session));
    }
  }

  return { sessionsById, liveSessions };
};
