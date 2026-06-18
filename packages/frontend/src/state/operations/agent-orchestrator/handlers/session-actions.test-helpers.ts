import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import { createSessionTurnState } from "../support/session-turn-state";
import {
  createAgentSessionRuntimeSnapshotFixture,
  createSessionObserversRefFixture,
  createTaskCardFixture,
} from "../test-utils";
import { createAgentSessionActions } from "./session-actions";

type BuildSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

export const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "session-1";

  return {
    runtimeKind: "opencode",
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "running",
    startedAt: "2026-02-22T08:00:00.000Z",
    workingDirectory: "/tmp/repo/worktree",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
    historyLoadState: sessionOverrides.historyLoadState ?? "not_requested",
  };
};

export const getSession = (
  sessionsRef: { current: AgentSessionCollection },
  externalSessionId = "session-1",
): AgentSessionState => {
  const session =
    listAgentSessions(sessionsRef.current).find(
      (entry) => entry.externalSessionId === externalSessionId,
    ) ?? null;
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

export const createSessionsRef = (sessions: AgentSessionState[] = []) => ({
  current: createAgentSessionCollection(sessions),
});

export const createSessionTurnStateFixture = () => {
  const sessionTurnState = createSessionTurnState();

  return {
    assistantTurnTiming: sessionTurnState.timing,
    turnMetadata: sessionTurnState.metadata,
    clearSessionTurnState: sessionTurnState.clearSession,
    sessionTurnState,
  };
};

export const mockAgentSessionRuntimeSnapshot = (
  adapter: OpencodeSdkAdapter,
  snapshot: ReturnType<
    typeof createAgentSessionRuntimeSnapshotFixture
  > = createAgentSessionRuntimeSnapshotFixture({ ref: { externalSessionId: "session-1" } }),
): ReturnType<typeof createAgentSessionRuntimeSnapshotFixture> => {
  adapter.listSessionRuntimeSnapshots = async () => [snapshot];
  adapter.readSessionRuntimeSnapshot = async () => snapshot;
  return snapshot;
};

type SessionActionDependencies = Parameters<typeof createAgentSessionActions>[0];
export type SessionActionTestOverrides = Partial<SessionActionDependencies> & {
  sessionsRef?: { current: AgentSessionCollection };
};

export const createSessionActions = (overrides: SessionActionTestOverrides = {}) => {
  const { sessionsRef: overrideSessionsRef, ...actionOverrides } = overrides;
  const adapter = actionOverrides.adapter ?? new OpencodeSdkAdapter();
  const sessionsRef = overrideSessionsRef ?? createSessionsRef();
  sessionsRef.current = createAgentSessionCollection(listAgentSessions(sessionsRef.current));
  const sessionTurnState = createSessionTurnStateFixture();

  const dependencies: SessionActionDependencies = {
    workspaceRepoPath: "/tmp/repo",
    workspaceId: "workspace-1",
    adapter,
    replaceSession: (session) => {
      sessionsRef.current = replaceAgentSession(sessionsRef.current, session);
    },
    removeSession: (identity) => {
      sessionsRef.current = removeAgentSession(sessionsRef.current, identity);
    },
    readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
    taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
    repoEpochRef: { current: 1 },
    currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
    sessionStartGateRef: { current: createSessionStartGate() },
    sessionObserversRef: createSessionObserversRefFixture(),
    sessionTurnState: sessionTurnState.sessionTurnState,
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionsRef.current, identity);
      if (!current) {
        return null;
      }
      const nextSession = updater(current);
      sessionsRef.current = replaceAgentSessionByIdentity(
        sessionsRef.current,
        identity,
        nextSession,
      );
      return nextSession;
    },
    observeAgentSession: async () => undefined,
    resolveTaskWorktree: async () => null,
    ensureRuntime: async () => ({
      kind: "opencode",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo",
    }),
    loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
    loadRepoPromptOverrides: async () => ({}),
    loadAgentSessions: async () => {},
    loadAgentSessionHistory: async () => {},
    refreshTaskData: async () => {},
    persistSessionRecord: async () => {},
    stopAuthoritativeSession: async () => {},
    invalidateSessionStopQueries: async () => {},
  };

  return createAgentSessionActions({
    ...dependencies,
    ...actionOverrides,
    adapter,
  });
};
