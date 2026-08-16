import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionAssociation } from "@openducktor/contracts";
import type { PropsWithChildren } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentOperationsContext, AgentSessionsContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionContextLoadTarget, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { createSessionMessagesState } from "../support/messages";
import { useSelectedSessionContextLoad } from "./use-selected-session-context-load";

const session = (externalSessionId: string): AgentSessionState => ({
  externalSessionId,
  taskId: "task-1",
  role: "build",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-07-16T08:00:00.000Z",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState(externalSessionId),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
});

const createWrapper = (
  operations: AgentOperationsContextValue,
  liveSession?: AgentSessionState,
  liveAssociation?: AgentSessionAssociation,
) => {
  const sessionStore = createAgentSessionsStore("/repo");
  if (liveSession && liveAssociation) {
    sessionStore.setLiveAssociations(
      () => new Map([[agentSessionIdentityKey(liveSession), liveAssociation]]),
    );
  }
  return ({ children }: PropsWithChildren) => (
    <AgentOperationsContext.Provider value={operations}>
      <AgentSessionsContext.Provider value={sessionStore}>{children}</AgentSessionsContext.Provider>
    </AgentOperationsContext.Provider>
  );
};

describe("useSelectedSessionContextLoad", () => {
  test("loads missing context for only the selected session", async () => {
    const loadAgentSessionContext = mock(
      async (_target: AgentSessionContextLoadTarget) => undefined,
    );
    const operations: AgentOperationsContextValue = {
      readSessionTodos: async () => [],
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => null,
      loadAgentSessionContext,
      startAgentSession: async () => {
        throw new Error("Not configured");
      },
      sendAgentMessage: async () => undefined,
      stopAgentSession: async () => undefined,
      updateAgentSessionModel: () => undefined,
      replyAgentApproval: async () => undefined,
      answerAgentQuestion: async () => undefined,
    };
    const wrapper = createWrapper(operations);
    const first = session("thread-1");
    const second = session("thread-2");
    const harness = createHookHarness(
      useSelectedSessionContextLoad,
      { session: first, repoReadinessState: "ready" as const },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessionContext.mock.calls.length === 1);
      expect(loadAgentSessionContext.mock.calls[0]?.[0]).toEqual({
        externalSessionId: "thread-1",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      });
      expect(loadAgentSessionContext).not.toHaveBeenCalledWith(
        expect.objectContaining({ externalSessionId: second.externalSessionId }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("omits workflow scope for a runtime-only child session", async () => {
    const loadAgentSessionContext = mock(
      async (_target: AgentSessionContextLoadTarget) => undefined,
    );
    const operations: AgentOperationsContextValue = {
      readSessionTodos: async () => [],
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => null,
      loadAgentSessionContext,
      startAgentSession: async () => {
        throw new Error("Not configured");
      },
      sendAgentMessage: async () => undefined,
      stopAgentSession: async () => undefined,
      updateAgentSessionModel: () => undefined,
      replyAgentApproval: async () => undefined,
      answerAgentQuestion: async () => undefined,
    };
    const wrapper = createWrapper(operations);
    const harness = createHookHarness(
      useSelectedSessionContextLoad,
      {
        session: { ...session("child-thread"), role: null },
        repoReadinessState: "ready" as const,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessionContext.mock.calls.length === 1);
      expect(loadAgentSessionContext.mock.calls[0]?.[0]).toEqual({
        externalSessionId: "child-thread",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("forwards repository scope for a live repository session", async () => {
    const loadAgentSessionContext = mock(
      async (_target: AgentSessionContextLoadTarget) => undefined,
    );
    const operations: AgentOperationsContextValue = {
      readSessionTodos: async () => [],
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => null,
      loadAgentSessionContext,
      startAgentSession: async () => {
        throw new Error("Not configured");
      },
      sendAgentMessage: async () => undefined,
      stopAgentSession: async () => undefined,
      updateAgentSessionModel: () => undefined,
      replyAgentApproval: async () => undefined,
      answerAgentQuestion: async () => undefined,
    };
    const repositorySession = { ...session("repository-thread"), taskId: "", role: null };
    const wrapper = createWrapper(operations, repositorySession, { kind: "repository" });
    const harness = createHookHarness(
      useSelectedSessionContextLoad,
      { session: repositorySession, repoReadinessState: "ready" as const },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessionContext.mock.calls.length === 1);
      expect(loadAgentSessionContext.mock.calls[0]?.[0]).toEqual({
        externalSessionId: "repository-thread",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        sessionScope: { kind: "repository" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not load context when retained usage is already present", async () => {
    const loadAgentSessionContext = mock(async () => undefined);
    const operations: AgentOperationsContextValue = {
      readSessionTodos: async () => [],
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => null,
      loadAgentSessionContext,
      startAgentSession: async () => {
        throw new Error("Not configured");
      },
      sendAgentMessage: async () => undefined,
      stopAgentSession: async () => undefined,
      updateAgentSessionModel: () => undefined,
      replyAgentApproval: async () => undefined,
      answerAgentQuestion: async () => undefined,
    };
    const wrapper = createWrapper(operations);
    const harness = createHookHarness(
      useSelectedSessionContextLoad,
      {
        session: { ...session("thread-1"), contextUsage: { totalTokens: 100 } },
        repoReadinessState: "ready" as const,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      expect(loadAgentSessionContext).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("returns an actionable error when selected-session context recovery fails", async () => {
    const loadAgentSessionContext = mock(async () => {
      throw new Error("thread resume failed");
    });
    const operations: AgentOperationsContextValue = {
      readSessionTodos: async () => [],
      readSessionHistory: async () => [],
      loadAgentSessionHistory: async () => null,
      loadAgentSessionContext,
      startAgentSession: async () => {
        throw new Error("Not configured");
      },
      sendAgentMessage: async () => undefined,
      stopAgentSession: async () => undefined,
      updateAgentSessionModel: () => undefined,
      replyAgentApproval: async () => undefined,
      answerAgentQuestion: async () => undefined,
    };
    const wrapper = createWrapper(operations);
    const harness = createHookHarness(
      useSelectedSessionContextLoad,
      { session: session("thread-1"), repoReadinessState: "ready" as const },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((error) => error !== null);
      expect(harness.getLatest()).toBe(
        'Failed to load context usage for session "thread-1": thread resume failed',
      );
    } finally {
      await harness.unmount();
    }
  });
});
