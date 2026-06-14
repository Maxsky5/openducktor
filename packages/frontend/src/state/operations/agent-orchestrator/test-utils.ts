import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentSessionPresenceSnapshot,
  AgentSessionRef,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSessionByExternalSessionId,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import {
  createDeferred as createSharedDeferred,
  createTaskCardFixture as createSharedTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createSessionListenerRegistry,
  hasSessionListenerForExternalSessionId,
  type SessionListenerRegistry,
  setSessionListener,
} from "./support/session-listener-registry";

const ORCHESTRATOR_TASK_CARD_DEFAULTS: Partial<TaskCard> = {
  title: "Task",
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

export const createDeferred = createSharedDeferred;

type SessionListenerRegistryFixture = {
  externalSessionId?: string;
  repoPath?: string;
  runtimeKind?: AgentSessionRef["runtimeKind"];
  workingDirectory?: string;
  unsubscribe?: () => void;
};

const toSessionListenerFixtureRef = ({
  externalSessionId = "external-1",
  repoPath = "/tmp/repo",
  runtimeKind = "opencode",
  workingDirectory = "/tmp/repo/worktree",
}: SessionListenerRegistryFixture): AgentSessionRef => ({
  externalSessionId,
  repoPath,
  runtimeKind,
  workingDirectory,
});

export const createSessionListenerRegistryFixture = (
  listeners: SessionListenerRegistryFixture[] = [],
): SessionListenerRegistry => {
  const registry = createSessionListenerRegistry();
  for (const listener of listeners) {
    setSessionListenerFixture(registry, listener);
  }
  return registry;
};

export const setSessionListenerFixture = (
  registry: SessionListenerRegistry,
  listener: SessionListenerRegistryFixture,
): void => {
  setSessionListener(
    registry,
    toSessionListenerFixtureRef(listener),
    listener.unsubscribe ?? (() => {}),
  );
};

export const createSessionListenerRegistryRefFixture = (
  listeners: SessionListenerRegistryFixture[] = [],
): { current: SessionListenerRegistry } => ({
  current: createSessionListenerRegistryFixture(listeners),
});

export const hasSessionListenerFixture = (
  registry: SessionListenerRegistry,
  externalSessionId: string,
): boolean => hasSessionListenerForExternalSessionId(registry, externalSessionId);

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
  getAgentSessionByExternalSessionId(sessionsRef.current, externalSessionId) ?? undefined;

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
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
): void => {
  const current = findAgentSessionFixture(sessionsRef, externalSessionId);
  if (!current) {
    return;
  }
  sessionsRef.current = replaceAgentSessionFixture(sessionsRef.current, updater(current));
};

const createLiveAgentSessionSnapshotFixture = (
  overrides: Partial<LiveAgentSessionSnapshot> = {},
): LiveAgentSessionSnapshot => {
  const externalSessionId = overrides.externalSessionId ?? "external-1";

  return {
    externalSessionId,
    title: overrides.title ?? "BUILD task-1",
    workingDirectory: "/tmp/repo/worktree",
    startedAt: "2026-02-22T08:00:00.000Z",
    status: { type: "idle" },
    pendingApprovals: [],
    pendingQuestions: [],
    ...overrides,
  };
};

export const createAgentSessionPresenceSnapshotFixture = ({
  ref: refOverrides = {},
  snapshot: snapshotOverrides = {},
}: {
  ref?: Partial<AgentSessionRef>;
  snapshot?: Partial<LiveAgentSessionSnapshot>;
} = {}): AgentSessionPresenceSnapshot => {
  const ref: AgentSessionRef = {
    repoPath: "/tmp/repo",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    externalSessionId: "external-1",
    ...refOverrides,
  };

  return toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref,
    snapshot: createLiveAgentSessionSnapshotFixture({
      ...snapshotOverrides,
      externalSessionId: ref.externalSessionId,
      workingDirectory: ref.workingDirectory,
    }),
  });
};
