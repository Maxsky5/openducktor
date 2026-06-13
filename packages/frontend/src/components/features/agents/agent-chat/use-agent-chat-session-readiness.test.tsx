import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentChatSessionReadiness } from "./use-agent-chat-session-readiness";

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
  historyLoadState: "loaded",
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

const activeWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

describe("useAgentChatSessionReadiness", () => {
  test("renders a running planner session without blocking on view readiness", async () => {
    const ensureSessionReadyForView = mock(async () => "ready" as const);
    const harness = createHookHarness(useAgentChatSessionReadiness, {
      activeWorkspace,
      activeTaskId: "task-1",
      activeSession: createSession(),
      repoReadinessState: "ready" as const,
      ensureSessionReadyForView,
    });

    try {
      await harness.mount();

      expect(ensureSessionReadyForView).not.toHaveBeenCalled();
      expect(harness.getLatest().selectedSessionLifecycle.canRenderHistory).toBe(true);
      expect(harness.getLatest().selectedSessionLifecycle.isLoadingHistory).toBe(false);
      expect(harness.getLatest().selectedSessionLifecycle.phase).toBe("ready");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps a selected session loading while runtime readiness is checking", async () => {
    const ensureSessionReadyForView = mock(async () => "ready" as const);
    const selectedSessionRoute = {
      externalSessionId: "planner-session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo-a",
    };
    const harness = createHookHarness(useAgentChatSessionReadiness, {
      activeWorkspace,
      activeTaskId: "task-1",
      selectedSessionRoute,
      activeSession: null,
      repoReadinessState: "checking" as const,
      ensureSessionReadyForView,
    });

    try {
      await harness.mount();

      expect(ensureSessionReadyForView).not.toHaveBeenCalled();
      expect(harness.getLatest().selectedSessionLifecycle.canRenderHistory).toBe(false);
      expect(harness.getLatest().selectedSessionLifecycle.isLoadingHistory).toBe(true);
      expect(harness.getLatest().selectedSessionLifecycle.isWaitingForRuntimeReadiness).toBe(true);
      expect(harness.getLatest().selectedSessionLifecycle.phase).toBe("waiting_for_runtime");
    } finally {
      await harness.unmount();
    }
  });

  test("marks cold running sessions loading before the readiness request settles", async () => {
    let resolveReady: (() => void) | undefined;
    const ensureSessionReadyForView = mock(
      async (): Promise<"ready"> =>
        await new Promise<"ready">((resolve) => {
          resolveReady = () => resolve("ready");
        }),
    );
    const hookArgs = {
      activeWorkspace,
      activeTaskId: "task-1",
      activeSession: createSession({ historyLoadState: "not_requested", messages: [] }),
      repoReadinessState: "ready" as const,
      ensureSessionReadyForView,
    };
    const harness = createHookHarness(useAgentChatSessionReadiness, hookArgs);

    try {
      await harness.mount();

      expect(harness.getLatest().selectedSessionLifecycle.canRenderHistory).toBe(false);
      expect(harness.getLatest().selectedSessionLifecycle.isLoadingHistory).toBe(true);
      await harness.waitFor(() => ensureSessionReadyForView.mock.calls.length === 1);
      if (resolveReady) {
        resolveReady();
      }
      await harness.update({
        ...hookArgs,
        activeSession: createSession(),
      });
      await harness.waitFor((state) => !state.selectedSessionLifecycle.isLoadingHistory);
    } finally {
      await harness.unmount();
    }
  });
});
