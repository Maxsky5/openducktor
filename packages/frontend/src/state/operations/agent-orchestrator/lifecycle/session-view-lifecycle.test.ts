import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  deriveAgentSessionViewLifecycle,
  deriveSelectedAgentSessionViewLifecycle,
} from "./session-view-lifecycle";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
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
  promptOverrides: {},
  ...overrides,
});

describe("deriveAgentSessionViewLifecycle", () => {
  test("requests background history hydration when a partial transcript exists", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        historyLoadState: "not_requested",
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
        historyLoadState: "failed",
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
    expect(lifecycle.isHistoryLoadFailed).toBe(false);
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
  });

  test("renders running sessions immediately without view readiness hydration", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        status: "running",
        historyLoadState: "loaded",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "already hydrated",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(false);
  });

  test("renders running planner sessions immediately when durable runtime context is available", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        role: "planner",
        status: "running",
        historyLoadState: "loaded",
        runtimeKind: "opencode",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "already hydrated",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.canReadRuntimeData).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(false);
  });

  test("loads a cold running session transcript before rendering it", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        status: "running",
        historyLoadState: "loading",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("loading_history");
    expect(lifecycle.canRenderHistory).toBe(false);
    expect(lifecycle.isLoadingHistory).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(false);
  });

  test("does not request view readiness while a local outbound send is pending", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        status: "running",
        historyLoadState: "loaded",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        pendingUserMessageStartedAt: 123,
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "new turn",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(false);
  });
});

describe("deriveSelectedAgentSessionViewLifecycle", () => {
  const selectedSessionRoute = {
    externalSessionId: "external-1",
    runtimeKind: "opencode" as const,
    workingDirectory: "/tmp/repo/worktree",
  };

  test("keeps a missing selected session loading while runtime readiness is checking", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: null,
      repoReadinessState: "checking",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      externalSessionId: "external-1",
      canRenderHistory: false,
      isLoadingHistory: true,
      isHistoryLoadFailed: false,
      isWaitingForRuntimeReadiness: true,
      shouldEnsureReadyForView: false,
    });
  });

  test("surfaces selected session load failures without a second local state machine", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: null,
      repoReadinessState: "ready",
      sessionLoadError: "Session history failed",
    });

    expect(lifecycle).toMatchObject({
      externalSessionId: "external-1",
      canRenderHistory: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: true,
      isWaitingForRuntimeReadiness: false,
      shouldEnsureReadyForView: false,
    });
  });

  test("delegates selected active session readiness to the session lifecycle", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: createSession({ historyLoadState: "not_requested", messages: [] }),
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      externalSessionId: "external-1",
      canRenderHistory: false,
      isLoadingHistory: true,
      isHistoryLoadFailed: false,
      isWaitingForRuntimeReadiness: false,
      shouldEnsureReadyForView: true,
    });
  });
});
