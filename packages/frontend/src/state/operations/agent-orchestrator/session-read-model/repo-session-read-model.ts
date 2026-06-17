import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionRef } from "@openducktor/core";
import { toMissingAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  fromPersistedSessionRecord,
  type PersistedTaskSessionRecord,
  toPersistedSessionIdentity,
} from "../support/persistence";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";
import {
  type AgentSessionRuntimeSnapshot,
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";

export type TaskSessionRecords = {
  id: string;
  agentSessions: AgentSessionRecord[];
};

export type RepoRuntimeSessionSnapshots = Map<string, AgentSessionRuntimeSnapshot>;

export type RepoSessionReadModel = {
  sessionCollection: AgentSessionCollection;
  liveSessionRefs: AgentSessionRef[];
  removedSessionRefs: AgentSessionRef[];
};

const collectTaskSessionRecords = (tasks: TaskSessionRecords[]): PersistedTaskSessionRecord[] => {
  const records: PersistedTaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of task.agentSessions) {
      records.push({ taskId: task.id, record });
    }
  }
  return records;
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
  const persisted = fromPersistedSessionRecord({ taskId, record });
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

const shouldKeepLocalSessionWithoutPersistedRecord = (session: AgentSessionState): boolean =>
  session.status === "starting";

export const readRepoRuntimeSessionSnapshots = async ({
  repoPath,
  tasks,
  listSessionRuntimeSnapshots,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  listSessionRuntimeSnapshots: AgentEnginePort["listSessionRuntimeSnapshots"];
}): Promise<RepoRuntimeSessionSnapshots> => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const { record } of taskSessionRecords) {
    const identity = toPersistedSessionIdentity(record);
    const runtimeKind = identity.runtimeKind;
    const directory = normalizeWorkingDirectory(identity.workingDirectory);
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

  return snapshotsBySessionKey;
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
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
}): RepoSessionReadModel => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const loadedTaskIds = new Set(tasks.map((task) => task.id));
  const persistedSessionKeys = new Set(
    taskSessionRecords.map(({ record }) =>
      agentSessionIdentityKey(toPersistedSessionIdentity(record)),
    ),
  );
  const currentSessions = currentSessionCollection ?? emptyAgentSessionCollection();
  const currentSessionsOutsideLoadedTasks = listAgentSessions(currentSessions).filter(
    (session) =>
      !loadedTaskIds.has(session.taskId) || shouldKeepLocalSessionWithoutPersistedRecord(session),
  );
  const removedSessionRefs = listAgentSessions(currentSessions)
    .filter(
      (session) =>
        loadedTaskIds.has(session.taskId) &&
        !persistedSessionKeys.has(agentSessionIdentityKey(session)) &&
        !shouldKeepLocalSessionWithoutPersistedRecord(session),
    )
    .map((session) => toRuntimeSessionRef(repoPath, session));
  let sessionCollection = createAgentSessionCollection(currentSessionsOutsideLoadedTasks);
  const liveSessionRefs: AgentSessionRef[] = [];

  for (const { taskId, record } of taskSessionRecords) {
    const identity = toPersistedSessionIdentity(record);
    const ref = toRuntimeSessionRef(repoPath, identity);
    const sessionKey = agentSessionIdentityKey(identity);
    const current = getAgentSession(currentSessions, identity) ?? undefined;
    const snapshot = runtimeSnapshots.get(sessionKey) ?? toMissingAgentSessionRuntimeSnapshot(ref);
    const persistedSessionView = toPersistedSessionView({
      taskId,
      record,
      current,
    });
    const session = applyRuntimeSnapshotToSession(persistedSessionView, snapshot);
    sessionCollection = replaceAgentSession(sessionCollection, session);

    if (shouldObserveAgentSessionRuntimeSnapshot(snapshot)) {
      liveSessionRefs.push(toRuntimeSessionRef(repoPath, session));
    }
  }

  return { sessionCollection, liveSessionRefs, removedSessionRefs };
};
