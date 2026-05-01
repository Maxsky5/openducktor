import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { deriveAgentSessionViewLifecycle } from "./session-view-lifecycle";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/tmp/repo/worktree",
  historyHydrationState: "not_requested",
  runtimeRecoveryState: "idle",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  promptOverrides: {},
  ...overrides,
});

describe("deriveAgentSessionViewLifecycle", () => {
  test("requests background history hydration when a partial transcript exists", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        historyHydrationState: "not_requested",
        messages: [
          {
            id: "tail-1",
            role: "assistant",
            content: "recent output only",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("needs_history");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
  });

  test("requests background hydration after a prior history failure when transcript exists", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        historyHydrationState: "failed",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "still visible",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("needs_history");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.isHistoryHydrationFailed).toBe(false);
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
  });
});
