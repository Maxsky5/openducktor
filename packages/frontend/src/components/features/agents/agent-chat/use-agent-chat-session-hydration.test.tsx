import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentChatSessionHydration } from "./use-agent-chat-session-hydration";

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

describe("useAgentChatSessionHydration", () => {
  test("recovers a running planner session that is missing runtime identity", async () => {
    const ensureSessionReadyForView = mock(async () => true);
    const harness = createHookHarness(useAgentChatSessionHydration, {
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      },
      activeTaskId: "task-1",
      activeSession: createSession(),
      repoReadinessState: "ready" as const,
      ensureSessionReadyForView,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => ensureSessionReadyForView.mock.calls.length === 1);

      expect(ensureSessionReadyForView).toHaveBeenCalledWith({
        taskId: "task-1",
        externalSessionId: "planner-session-1",
        repoReadinessState: "ready",
      });
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
    } finally {
      await harness.unmount();
    }
  });
});
