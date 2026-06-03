import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentSessionHydration } from "./use-agent-session-hydration";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "planner-session-1",
  taskId: "task-1",
  repoPath: "/repo-a",
  role: "planner",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  workingDirectory: "/repo-a",
  historyHydrationState: "hydrated",
  runtimeRecoveryState: "idle",
  messages: [
    {
      id: "message-1",
      role: "assistant",
      content: "Planner output",
      timestamp: "2026-02-22T08:00:01.000Z",
    },
  ],
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

describe("useAgentSessionHydration", () => {
  test("allows live reattach when preparing a running planner session for view", async () => {
    const loadAgentSessions = mock(async () => undefined);
    const session = createSession();
    const sessionsRef = { current: { [session.externalSessionId]: session } };
    const harness = createHookHarness(useAgentSessionHydration, {
      loadAgentSessions,
      sessionsRef,
      updateSession: () => undefined,
    });

    try {
      await harness.mount();

      await harness.run(async ({ ensureSessionReadyForView }) => {
        await ensureSessionReadyForView({
          taskId: "task-1",
          externalSessionId: session.externalSessionId,
          repoReadinessState: "ready",
        });
      });

      expect(loadAgentSessions).toHaveBeenCalledWith("task-1", {
        mode: "requested_history",
        targetExternalSessionId: session.externalSessionId,
        historyPolicy: "none",
        allowLiveSessionResume: true,
      });
    } finally {
      await harness.unmount();
    }
  });
});
