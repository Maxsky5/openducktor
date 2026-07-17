import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

const session = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "thread-1",
  taskId: "task-1",
  role: "build",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-07-16T08:00:00.000Z",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState("thread-1"),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});

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
) => {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider useIsolatedClient>
      <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
        {children}
      </AgentOperationsContext.Provider>
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
      },
      repoReadinessState: "ready" as const,
      liveSession,
    },
    { wrapper },
  );
};

describe("useRuntimeTranscriptSessionHistory", () => {
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
        <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
          {children}
        </AgentOperationsContext.Provider>
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
        <AgentOperationsContext.Provider value={operations(async () => null, readSessionHistory)}>
          {children}
        </AgentOperationsContext.Provider>
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
