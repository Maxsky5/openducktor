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
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

describe("useAgentSessionHistory", () => {
  test("does not load history when a running session history is already loaded", async () => {
    const loadAgentSessionHistory = mock(async () => undefined);
    const session = createSession({ historyLoadState: "loaded" });
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHistory, {
      loadAgentSessionHistory,
      sessionsRef,
    });

    try {
      await harness.mount();

      await harness.run(async ({ ensureSessionReadyForView }) => {
        const result = await ensureSessionReadyForView({
          taskId: "task-1",
          externalSessionId: session.externalSessionId,
          repoReadinessState: "ready",
        });
        expect(result).toBe("ready");
      });

      expect(loadAgentSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("resolves expected history load failures as a failed readiness outcome", async () => {
    const loadAgentSessionHistory = mock(async () => {
      throw new Error("history unavailable");
    });
    const session = createSession();
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHistory, {
      loadAgentSessionHistory,
      sessionsRef,
    });

    try {
      await harness.mount();

      await harness.run(async ({ ensureSessionReadyForView }) => {
        const result = await ensureSessionReadyForView({
          taskId: "task-1",
          externalSessionId: session.externalSessionId,
          repoReadinessState: "ready",
        });
        expect(result).toBe("failed");
      });

      expect(loadAgentSessionHistory).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
