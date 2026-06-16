import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import { toMissingAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { normalizeWorkingDirectory } from "../support/core";
import { fromPersistedSessionRecord } from "../support/persistence";
import { toPersistedRuntimeSessionRef, toRuntimeSessionRef } from "../support/session-runtime-ref";
import {
  type AgentSessionRuntimeSnapshot,
  applyAgentSessionRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";

type TaskSessionRecord = {
  taskId: string;
  record: AgentSessionRecord;
};

export type TaskSessionRecords = {
  id: string;
  agentSessions: AgentSessionRecord[];
};

export type RepoRuntimeSessionSnapshotRead = {
  snapshotsBySessionKey: Map<string, AgentSessionRuntimeSnapshot>;
};

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRef[];
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

export const readRepoRuntimeSessionSnapshots = async ({
  repoPath,
  tasks,
  listSessionRuntimeSnapshots,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  listSessionRuntimeSnapshots: AgentEnginePort["listSessionRuntimeSnapshots"];
}): Promise<RepoRuntimeSessionSnapshotRead> => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const { record } of taskSessionRecords) {
    const ref = toPersistedRuntimeSessionRef({ repoPath, record });
    const runtimeKind = ref.runtimeKind;
    const directory = normalizeWorkingDirectory(ref.workingDirectory);
    const directories = directoriesByRuntimeKind.get(runtimeKind) ?? new Set<string>();
    directories.add(directory);
    directoriesByRuntimeKind.set(runtimeKind, directories);
  }

  const snapshotsBySessionKey = new Map<string, AgentSessionRuntimeSnapshot>();
  await Promise.all(
    Array.from(directoriesByRuntimeKind.entries()).map(async ([runtimeKind, directorySet]) => {
      const directories = Array.from(directorySet).sort();
      const snapshots = await listSessionRuntimeSnapshots({ repoPath, runtimeKind, directories });
      for (const snapshot of snapshots) {
        if (
          snapshot.ref.runtimeKind !== runtimeKind ||
          !directorySet.has(normalizeWorkingDirectory(snapshot.ref.workingDirectory))
        ) {
          continue;
        }
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
  runtimeSnapshots,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionCollection?: AgentSessionCollection;
  runtimeSnapshots: RepoRuntimeSessionSnapshotRead;
}): RepoSessionReadModel => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const currentSessions = currentSessionCollection ?? emptyAgentSessionCollection();
  let sessionCollection = selectLocalSessions(currentSessions, taskSessionRecords);
  const liveSessionRefs: AgentSessionRef[] = [];

  for (const { taskId, record } of taskSessionRecords) {
    const ref = toPersistedRuntimeSessionRef({ repoPath, record });
    const sessionKey = agentSessionIdentityKey(ref);
    const current = getAgentSession(currentSessions, record) ?? undefined;
    const snapshot =
      runtimeSnapshots.snapshotsBySessionKey.get(sessionKey) ??
      toMissingAgentSessionRuntimeSnapshot(ref);
    const persistedSessionView = toPersistedSessionView({
      taskId,
      record,
      current,
    });
    const session = applyAgentSessionRuntimeSnapshotToSession(persistedSessionView, snapshot);
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (shouldObserveAgentSessionRuntimeSnapshot(snapshot)) {
      liveSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  return { sessionCollection, liveSessionRefs };
};
