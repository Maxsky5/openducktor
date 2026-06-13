import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentSessionHistory } from "./use-agent-session-history";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "planner-session-1",
  taskId: "task-1",
  repoPath: "/repo-a",
  role: "planner",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a",
  historyLoadState: "not_requested",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});

describe("useAgentSessionHistory", () => {
  test("does not load history when a running session history is already loaded", async () => {
    const loadSelectedSessionHistory = mock(async () => undefined);
    const session = createSession({ historyLoadState: "loaded" });
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHistory, {
      loadSelectedSessionHistory,
      sessionsRef,
    });

    try {
      await harness.mount();

      await harness.run(async ({ loadSelectedSessionHistoryForView }) => {
        await loadSelectedSessionHistoryForView({
          externalSessionId: session.externalSessionId,
          repoReadinessState: "ready",
        });
      });

      expect(loadSelectedSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("loads selected session history from the selected session state", async () => {
    const loadSelectedSessionHistory = mock(async () => undefined);
    const session = createSession();
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHistory, {
      loadSelectedSessionHistory,
      sessionsRef,
    });

    try {
      await harness.mount();

      await harness.run(async ({ loadSelectedSessionHistoryForView }) => {
        await loadSelectedSessionHistoryForView({
          externalSessionId: session.externalSessionId,
          repoReadinessState: "ready",
        });
      });

      expect(loadSelectedSessionHistory).toHaveBeenCalledWith({ session });
    } finally {
      await harness.unmount();
    }
  });

  test("propagates expected history load failures", async () => {
    const loadSelectedSessionHistory = mock(async () => {
      throw new Error("history unavailable");
    });
    const session = createSession();
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHistory, {
      loadSelectedSessionHistory,
      sessionsRef,
    });

    try {
      await harness.mount();

      await expect(
        harness.run(async ({ loadSelectedSessionHistoryForView }) =>
          loadSelectedSessionHistoryForView({
            externalSessionId: session.externalSessionId,
            repoReadinessState: "ready",
          }),
        ),
      ).rejects.toThrow("history unavailable");

      expect(loadSelectedSessionHistory).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
