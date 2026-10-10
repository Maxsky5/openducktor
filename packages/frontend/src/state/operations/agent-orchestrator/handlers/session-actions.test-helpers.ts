import { AgentRuntimeTestAdapter } from "../../../../test-support/agent-runtime-test-adapter";
import type { AgentEnginePort } from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSessionByIdentity,
} from "@/state/agent-session-collection";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { closeProjectedBackgroundQuestions } from "../session-read-model/agent-session-live-projection";
import { createSessionTurnState } from "../support/session-turn-state";
import { createTaskCardFixture } from "../test-utils";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { createAgentSessionActions } from "./session-actions";

type BuildSessionOverrides = AgentSessionFixtureOverrides;

export const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  return createAgentSessionFixture(
    {
      runtimeKind: "opencode",
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      status: "running",
      runtimeStatusMessage: null,
      startedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
      messages: createSessionMessagesFixture("session-1"),
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
      historyLoadState: "not_requested",
    },
    overrides,
  );
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

type SessionActionDependencies = Parameters<typeof createAgentSessionActions>[0];
export type SessionActionTestOverrides = Omit<Partial<SessionActionDependencies>, "adapter"> & {
  adapter?: AgentEnginePort | AgentRuntimeTestAdapter;
  sessionsRef?: { current: AgentSessionCollection };
};

export const createSessionActions = (overrides: SessionActionTestOverrides = {}) => {
  const {
    adapter: adapterOverride,
    sessionsRef: overrideSessionsRef,
    ...actionOverrides
  } = overrides;
  const adapterCandidate = adapterOverride ?? new AgentRuntimeTestAdapter();
  const adapter =
    adapterCandidate instanceof AgentRuntimeTestAdapter
      ? createOpenCodeAgentEngineTestAdapter(adapterCandidate)
      : adapterCandidate;
  const sessionsRef = overrideSessionsRef ?? createSessionsRef();
  sessionsRef.current = createAgentSessionCollection(listAgentSessions(sessionsRef.current));
  const sessionTurnState = createSessionTurnStateFixture();

  const dependencies: SessionActionDependencies = {
    workspaceRepoPath: "/tmp/repo",
    workspaceId: "workspace-1",
    adapter,

    readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
    taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
    repoEpochRef: { current: 1 },
    currentWorkspaceRepoPathRef: { current: "/tmp/repo" },

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
    closeBackgroundQuestions: (identity, requestIds) => {
      sessionsRef.current = closeProjectedBackgroundQuestions(
        sessionsRef.current,
        identity,
        requestIds,
      );
    },

    loadRepoPromptOverrides: async () => ({}),

    liveSessionHost: {
      agentSessionLiveReplyApproval: async () => {},
      agentSessionLiveReplyQuestion: async () => {},
    },

    refreshTaskData: async () => {},
    invalidateSessionStopQueries: async () => {},
  };

  return createAgentSessionActions({
    ...dependencies,
    ...actionOverrides,
    adapter,
  });
};
