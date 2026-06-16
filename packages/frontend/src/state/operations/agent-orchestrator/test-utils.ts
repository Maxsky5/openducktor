import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentSessionRef,
  AgentSessionRuntimeSnapshot,
  AgentSessionRuntimeSnapshotSource,
} from "@openducktor/core";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import {
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionObservers, type SessionObservers } from "./support/session-observers";

const ORCHESTRATOR_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task",
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

export const createDeferred = createSharedDeferred;

type SessionObserversFixture = {
  externalSessionId?: string;
  repoPath?: string;
  runtimeKind?: AgentSessionRef["runtimeKind"];
  workingDirectory?: string;
  unsubscribe?: () => void;
};

const toSessionObserverFixtureRef = ({
  externalSessionId = "external-1",
  repoPath = "/tmp/repo",
  runtimeKind = "opencode",
  workingDirectory = "/tmp/repo/worktree",
}: SessionObserversFixture): AgentSessionRef => ({
  externalSessionId,
  repoPath,
  runtimeKind,
  workingDirectory,
});

export const createSessionObserversFixture = (
  observers: SessionObserversFixture[] = [],
): SessionObservers => {
  return createSessionObservers(
    observers.map((observer) => ({
      session: toSessionObserverFixtureRef(observer),
      unsubscribe: observer.unsubscribe ?? (() => {}),
    })),
  );
};

export const createSessionObserversRefFixture = (
  observers: SessionObserversFixture[] = [],
): { current: SessionObservers } => ({
  current: createSessionObserversFixture(observers),
});

export const hasSessionObserverFixture = (
  observers: SessionObservers,
  observer: SessionObserversFixture,
): boolean => observers.has(toSessionObserverFixtureRef(observer));

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | "timeout"> => {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
};

export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): TaskCard =>
  createSharedTaskCardFixture(ORCHESTRATOR_TASK_CARD_DEFAULTS, overrides);

export type AgentSessionCollectionRef = { current: AgentSessionCollection };

export const createAgentSessionCollectionRefFixture = (
  sessions: AgentSessionState[],
): AgentSessionCollectionRef => ({
  current: createAgentSessionCollection(sessions),
});

export const findAgentSessionFixture = (
  sessionsRef: AgentSessionCollectionRef,
  externalSessionId = "session-1",
): AgentSessionState | undefined =>
  listAgentSessions(sessionsRef.current).find(
    (session) => session.externalSessionId === externalSessionId,
  );

export const getAgentSessionFixture = (
  sessionsRef: AgentSessionCollectionRef,
  externalSessionId = "session-1",
): AgentSessionState => {
  const session = findAgentSessionFixture(sessionsRef, externalSessionId);
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

export const replaceAgentSessionFixture = (
  collection: AgentSessionCollection,
  session: AgentSessionState,
): AgentSessionCollection => replaceAgentSession(collection, session);

export const updateAgentSessionFixture = (
  sessionsRef: AgentSessionCollectionRef,
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
): AgentSessionState | null => {
  const current = getAgentSession(sessionsRef.current, identity);
  if (!current) {
    return null;
  }
  const nextSession = updater(current);
  sessionsRef.current = replaceAgentSessionByIdentity(sessionsRef.current, identity, nextSession);
  return nextSession;
};

const createRuntimeSnapshotSourceFixture = (
  overrides: Partial<AgentSessionRuntimeSnapshotSource> = {},
): AgentSessionRuntimeSnapshotSource => {
  return {
    title: overrides.title ?? "BUILD task-1",
    startedAt: "2026-02-22T08:00:00.000Z",
    runtimeActivity: "idle",
    pendingApprovals: [],
    pendingQuestions: [],
    ...overrides,
  };
};

export const createAgentSessionRuntimeSnapshotFixture = ({
  ref: refOverrides = {},
  snapshot: snapshotOverrides = {},
}: {
  ref?: Partial<AgentSessionRef>;
  snapshot?: Partial<AgentSessionRuntimeSnapshotSource>;
} = {}): AgentSessionRuntimeSnapshot => {
  const ref: AgentSessionRef = {
    repoPath: "/tmp/repo",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    externalSessionId: "external-1",
    ...refOverrides,
  };

  return toAgentSessionRuntimeSnapshot({
    ref,
    snapshot: createRuntimeSnapshotSourceFixture({
      ...snapshotOverrides,
    }),
  });
};
