import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
} from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionState,
} from "@/types/agent-orchestrator";
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
  agentSessions?: AgentSessionRecord[] | undefined;
};

export type RepoSessionPresenceRead = {
  presenceBySessionKey: Map<string, AgentSessionPresenceSnapshot>;
};

export type RepoSessionReadModel = {
  sessionsById: Record<string, AgentSessionState>;
  liveSessions: AgentSessionRef[];
};

const toPresenceKey = (
  runtimeKind: RuntimeKind,
  workingDirectory: string,
  externalSessionId: string,
): string => `${runtimeKind}::${normalizeWorkingDirectory(workingDirectory)}::${externalSessionId}`;

const collectTaskSessionRecords = (tasks: TaskSessionRecords[]): TaskSessionRecord[] => {
  const records: TaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of task.agentSessions ?? []) {
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
  if (session.purpose === "transcript") {
    return true;
  }
  return !persistedSessionIds.has(session.externalSessionId) && session.status !== "stopped";
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

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const areValuesEquivalent = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((leftValue, index) => areValuesEquivalent(leftValue, right[index]))
    );
  }

  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && areValuesEquivalent(left[key], right[key]),
      )
    );
  }

  return false;
};

const sortPendingRequestsById = <T extends { requestId: string }>(requests: readonly T[]): T[] =>
  [...requests].sort((left, right) => left.requestId.localeCompare(right.requestId));

const normalizeSessionPendingRequests = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  pendingApprovals: sortPendingRequestsById(session.pendingApprovals),
  pendingQuestions: sortPendingRequestsById(session.pendingQuestions),
});

const arePendingRequestsEquivalent = <T extends AgentApprovalRequest | AgentQuestionRequest>(
  left: readonly T[],
  right: readonly T[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const leftRequests = sortPendingRequestsById(left);
  const rightRequests = sortPendingRequestsById(right);
  return leftRequests.every((request, index) => areValuesEquivalent(request, rightRequests[index]));
};

const areModelSelectionsEquivalent = (
  left: AgentSessionState["selectedModel"],
  right: AgentSessionState["selectedModel"],
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.runtimeKind === right.runtimeKind &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant &&
    left.profileId === right.profileId
  );
};

const areReadModelFieldsEquivalent = (left: AgentSessionState, right: AgentSessionState): boolean =>
  left.title === right.title &&
  left.taskId === right.taskId &&
  left.repoPath === right.repoPath &&
  left.runtimeKind === right.runtimeKind &&
  left.role === right.role &&
  left.status === right.status &&
  left.startedAt === right.startedAt &&
  left.workingDirectory === right.workingDirectory &&
  areModelSelectionsEquivalent(left.selectedModel, right.selectedModel) &&
  arePendingRequestsEquivalent(left.pendingApprovals, right.pendingApprovals) &&
  arePendingRequestsEquivalent(left.pendingQuestions, right.pendingQuestions);

const reuseCurrentSessionWhenReadModelIsEquivalent = (
  current: AgentSessionState | undefined,
  next: AgentSessionState,
): AgentSessionState => {
  if (!current) {
    return next;
  }
  return areReadModelFieldsEquivalent(current, next) ? current : next;
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

export const readRepoSessionPresence = async ({
  repoPath,
  tasks,
  listSessionPresence,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  listSessionPresence: AgentEnginePort["listSessionPresence"];
}): Promise<RepoSessionPresenceRead> => {
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

  const presenceBySessionKey = new Map<string, AgentSessionPresenceSnapshot>();
  await Promise.all(
    Array.from(directoriesByRuntimeKind.entries()).map(async ([runtimeKind, directorySet]) => {
      const directories = Array.from(directorySet).sort();
      const snapshots = await listSessionPresence({ repoPath, runtimeKind, directories });
      for (const snapshot of snapshots) {
        presenceBySessionKey.set(
          toPresenceKey(
            snapshot.ref.runtimeKind,
            snapshot.ref.workingDirectory,
            snapshot.ref.externalSessionId,
          ),
          snapshot,
        );
      }
    }),
  );

  for (const { record } of taskSessionRecords) {
    const ref = toPersistedSessionRef({ repoPath, record });
    const sessionKey = toPresenceKey(ref.runtimeKind, ref.workingDirectory, ref.externalSessionId);
    if (!presenceBySessionKey.has(sessionKey)) {
      presenceBySessionKey.set(
        sessionKey,
        toAgentSessionPresenceSnapshotFromLiveSnapshot({
          ref,
          snapshot: null,
        }),
      );
    }
  }

  return { presenceBySessionKey };
};

export const buildRepoSessionReadModel = ({
  repoPath,
  tasks,
  currentSessionsById = {},
  presence,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  currentSessionsById?: Record<string, AgentSessionState>;
  presence: RepoSessionPresenceRead;
}): RepoSessionReadModel => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const sessionsById = { ...selectLocalSessions(currentSessionsById, taskSessionRecords) };
  const liveSessions: AgentSessionRef[] = [];

  for (const { taskId, record } of taskSessionRecords) {
    const runtimeKind = readPersistedRuntimeKind(record);
    const sessionKey = toPresenceKey(
      runtimeKind,
      record.workingDirectory,
      record.externalSessionId,
    );
    const current = currentSessionsById[record.externalSessionId];
    const snapshot = presence.presenceBySessionKey.get(sessionKey);
    if (!snapshot) {
      throw new Error(`Missing runtime presence for session '${record.externalSessionId}'.`);
    }
    const baseSession = toPersistedSessionView({
      repoPath,
      taskId,
      record,
      current,
    });
    const nextSession = normalizeSessionPendingRequests(
      applyAgentSessionPresenceSnapshotToSession(baseSession, snapshot),
    );

    const storedSession = reuseCurrentSessionWhenReadModelIsEquivalent(current, nextSession);
    sessionsById[record.externalSessionId] = storedSession;

    if (shouldListenToAgentSessionPresenceSnapshot(snapshot)) {
      liveSessions.push(toRuntimeSessionRef(storedSession));
    }
  }

  return { sessionsById, liveSessions };
};
