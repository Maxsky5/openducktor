import { describe, expect, mock, test } from "bun:test";
import type { PropsWithChildren } from "react";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness } from "@/test-utils/react-hook-harness";
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
): AgentOperationsContextValue => ({
  readSessionTodos: async () => [],
  readSessionHistory: async () => [],
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
  loadAgentSessionHistory: AgentOperationsContextValue["loadAgentSessionHistory"],
) => {
  const wrapper = ({ children }: PropsWithChildren) => (
    <AgentOperationsContext.Provider value={operations(loadAgentSessionHistory)}>
      {children}
    </AgentOperationsContext.Provider>
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
  test("keeps pending input visible while selected history remains unresolved", async () => {
    const never = new Promise<AgentSessionState | null>(() => undefined);
    const loadAgentSessionHistory = mock(async () => never);
    const liveSession = session({
      pendingApprovals: [
        {
          requestId: "opaque-1",
          requestType: "command_execution",
          title: "Run command",
        },
      ],
    });
    const harness = createHarness(liveSession, loadAgentSessionHistory);

    try {
      await harness.mount();
      await harness.waitFor(() => loadAgentSessionHistory.mock.calls.length === 1);
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
      expect(harness.getLatest().interactionSession?.pendingApprovals).toHaveLength(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not request history again after it is loaded", async () => {
    const loadAgentSessionHistory = mock(async () => null);
    const harness = createHarness(session({ historyLoadState: "loaded" }), loadAgentSessionHistory);

    try {
      await harness.mount();
      expect(loadAgentSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });
});
