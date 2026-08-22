import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionHistoryMessage,
  AgentSessionScope,
  AgentSkillReference,
} from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { createRuntimeDefinitionsContextValue } from "@/pages/agents/agent-studio-test-utils";
import { AgentOperationsContext, RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

const session = (overrides: AgentSessionFixtureOverrides = {}): AgentSessionState =>
  createAgentSessionFixture(
    {
      externalSessionId: "thread-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-07-16T08:00:00.000Z",
      historyLoadState: "not_requested",
      messages: createSessionMessagesState("thread-1"),
    },
    overrides,
  );

const operations = (
  loadAgentSessionHistory: AgentOperationsContextValue["loadAgentSessionHistory"],
  readSessionHistory: AgentOperationsContextValue["readSessionHistory"] = async () => [],
): AgentOperationsContextValue => ({
  readSessionTodos: async () => [],
  readSessionHistory,
  loadAgentSessionHistory,
  loadAgentSessionContext: async () => undefined,
  startAgentSession: async () => {
    throw new Error("Not configured");
  },
  sendAgentMessage: async () => undefined,
  stopAgentSession: async () => undefined,
  updateAgentSessionModel: () => undefined,
  replyAgentApproval: async () => undefined,
  answerAgentQuestion: async () => undefined,
});

const createHarness = (
  liveSession: AgentSessionState,
  readSessionHistory: AgentOperationsContextValue["readSessionHistory"],
  targetSessionScope?: AgentSessionScope,
) => {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider useIsolatedClient>
      <RuntimeDefinitionsContext.Provider value={createRuntimeDefinitionsContextValue()}>
        <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
          {children}
        </AgentOperationsContext.Provider>
      </RuntimeDefinitionsContext.Provider>
    </QueryProvider>
  );
  return createHookHarness(
    useRuntimeTranscriptSessionHistory,
    {
      isOpen: true,
      repoPath: "/repo",
      target: {
        externalSessionId: liveSession.externalSessionId,
        runtimeKind: liveSession.runtimeKind,
        workingDirectory: liveSession.workingDirectory,
        ...(targetSessionScope ? { sessionScope: targetSessionScope } : undefined),
      },
      repoReadinessState: "ready" as const,
      liveSession,
    },
    { wrapper },
  );
};

describe("useRuntimeTranscriptSessionHistory", () => {
  test("uses a workflow target for a matching unbound live session", async () => {
    const readSessionHistory = mock(async () => []);
    const harness = createHarness(
      session({ runtimeKind: "opencode", sessionAssociation: { kind: "unbound" } }),
      readSessionHistory,
      { kind: "workflow", taskId: "task-1", role: "build" },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses a repository target for a matching unbound live session", async () => {
    const readSessionHistory = mock(async () => []);
    const harness = createHarness(
      session({ runtimeKind: "opencode", sessionAssociation: { kind: "unbound" } }),
      readSessionHistory,
      { kind: "repository" },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ sessionScope: { kind: "repository" } }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses matching target and live workflow scopes", async () => {
    const readSessionHistory = mock(async () => []);
    const workflowScope = { kind: "workflow", taskId: "task-1", role: "build" } as const;
    const harness = createHarness(
      session({ runtimeKind: "opencode", sessionAssociation: workflowScope }),
      readSessionHistory,
      workflowScope,
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ sessionScope: workflowScope }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("rejects conflicting target and live workflow scopes", async () => {
    const readSessionHistory = mock(async () => []);
    const harness = createHarness(session({ runtimeKind: "opencode" }), readSessionHistory, {
      kind: "workflow",
      taskId: "task-2",
      role: "qa",
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.transcriptState.kind === "failed");

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().transcriptState).toEqual({
        kind: "failed",
        message:
          "Cannot load transcript history for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the requested workflow scope for task 'task-2' and role 'qa'.",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("forwards repository scope unchanged to the history request", async () => {
    const readSessionHistory = mock(async () => []);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryProvider useIsolatedClient>
        <RuntimeDefinitionsContext.Provider value={createRuntimeDefinitionsContextValue()}>
          <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
            {children}
          </AgentOperationsContext.Provider>
        </RuntimeDefinitionsContext.Provider>
      </QueryProvider>
    );
    const harness = createHookHarness(
      useRuntimeTranscriptSessionHistory,
      {
        isOpen: true,
        repoPath: "/repo",
        target: {
          externalSessionId: "repository-thread",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          sessionScope: { kind: "repository" },
        },
        repoReadinessState: "ready" as const,
        liveSession: null,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "repository-thread",
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "opencode" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("loads a completed child transcript without a live projection entry", async () => {
    const history: AgentSessionHistoryMessage[] = [
      {
        messageId: "assistant-child-1",
        role: "assistant",
        timestamp: "2026-07-17T08:00:00.000Z",
        text: "Completed child output",
        parts: [],
      },
    ];
    const readSessionHistory = mock(async () => history);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryProvider useIsolatedClient>
        <RuntimeDefinitionsContext.Provider value={createRuntimeDefinitionsContextValue()}>
          <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
            {children}
          </AgentOperationsContext.Provider>
        </RuntimeDefinitionsContext.Provider>
      </QueryProvider>
    );
    const harness = createHookHarness(
      useRuntimeTranscriptSessionHistory,
      {
        isOpen: true,
        repoPath: "/repo",
        target: {
          externalSessionId: "child-thread",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        repoReadinessState: "ready" as const,
        liveSession: null,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "child-thread",
        runtimePolicy: { kind: "opencode" },
      });
      expect(harness.getLatest().session?.messages.items[0]?.content).toBe(
        "Completed child output",
      );
      expect(harness.getLatest().interactionSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("loads completed Codex child history through a policy-bound runtime ref", async () => {
    const readSessionHistory = mock(async () => []);
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <RuntimeDefinitionsContext.Provider value={createRuntimeDefinitionsContextValue()}>
          <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
            {children}
          </AgentOperationsContext.Provider>
        </RuntimeDefinitionsContext.Provider>
      </QueryClientProvider>
    );
    const harness = createHookHarness(
      useRuntimeTranscriptSessionHistory,
      {
        isOpen: true,
        repoPath: "/repo",
        target: {
          externalSessionId: "child-thread",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
        },
        repoReadinessState: "ready" as const,
        liveSession: null,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
          externalSessionId: "child-thread",
          runtimePolicy: expect.objectContaining({ kind: "codex" }),
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps pending input visible while selected history remains unresolved", async () => {
    const never = new Promise<AgentSessionHistoryMessage[]>(() => undefined);
    const readSessionHistory = mock(async () => never);
    const liveSession = session({
      runtimeKind: "opencode",
      pendingApprovals: [
        {
          requestId: "opaque-1",
          requestType: "command_execution",
          title: "Run command",
        },
      ],
    });
    const harness = createHarness(liveSession, readSessionHistory);

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
      expect(harness.getLatest().interactionSession?.pendingApprovals).toHaveLength(1);
    } finally {
      await harness.unmount();
    }
  });

  test("shows Claude history before the separate skill catalog resolves", async () => {
    const history: AgentSessionHistoryMessage[] = [
      {
        messageId: "user-skill-1",
        role: "user",
        timestamp: "2026-07-27T10:00:00.000Z",
        text: "/grill-me",
        displayParts: [{ kind: "text", text: "/grill-me" }],
        state: "read",
        parts: [],
      },
    ];
    const readSessionHistory = mock(async () => history);
    let resolveSkills: ((catalog: { skills: AgentSkillReference[] }) => void) | undefined;
    const loadRepoRuntimeSkills = mock(
      () =>
        new Promise<{ skills: AgentSkillReference[] }>((resolve) => {
          resolveSkills = resolve;
        }),
    );
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <RuntimeDefinitionsContext.Provider
          value={createRuntimeDefinitionsContextValue({ loadRepoRuntimeSkills })}
        >
          <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
            {children}
          </AgentOperationsContext.Provider>
        </RuntimeDefinitionsContext.Provider>
      </QueryClientProvider>
    );
    const harness = createHookHarness(
      useRuntimeTranscriptSessionHistory,
      {
        isOpen: true,
        repoPath: "/repo",
        target: {
          externalSessionId: "claude-thread",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
        },
        repoReadinessState: "ready" as const,
        liveSession: null,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);
      expect(harness.getLatest().session?.messages.items[0]?.content).toBe("/grill-me");
      expect(harness.getLatest().session?.messages.items[0]?.meta).toMatchObject({
        kind: "user",
        parts: [{ kind: "text", text: "/grill-me" }],
      });

      resolveSkills?.({
        skills: [
          {
            id: "grill-me",
            name: "grill-me",
            path: "grill-me",
            title: "grill-me",
          },
        ],
      });
      await harness.waitFor((state) => {
        const meta = state.session?.messages.items[0]?.meta;
        return (
          meta?.kind === "user" &&
          meta.parts?.some((part) => part.kind === "skill_mention") === true
        );
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not request history again after it is loaded", async () => {
    const readSessionHistory = mock(async () => []);
    const harness = createHarness(session({ historyLoadState: "loaded" }), readSessionHistory);

    try {
      await harness.mount();
      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });
});
