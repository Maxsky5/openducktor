import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  deriveAgentSessionViewLifecycle,
  deriveSelectedAgentSessionViewLifecycle,
  getAgentSessionTranscriptState,
  isSelectedAgentSessionViewLoading,
  isSelectedAgentSessionWaitingForRuntimeReadiness,
} from "./session-view-lifecycle";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
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
  selectedModel: null,
  ...overrides,
});

describe("deriveAgentSessionViewLifecycle", () => {
  test("requests background history load when a partial transcript exists", () => {
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
    expect(lifecycle.shouldLoadHistory).toBe(true);
  });

  test("requests background history load after a prior history failure when transcript exists", () => {
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
    expect(lifecycle.shouldLoadHistory).toBe(true);
  });

  test("renders running sessions immediately without view readiness loading", () => {
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
            content: "already loaded",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.shouldLoadHistory).toBe(false);
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
            content: "already loaded",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.canReadRuntimeData).toBe(true);
    expect(lifecycle.shouldLoadHistory).toBe(false);
  });

  test("loads a cold running session transcript before rendering it", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        status: "running",
        historyLoadState: "not_requested",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("loading_history");
    expect(lifecycle.canRenderHistory).toBe(false);
    expect(lifecycle.shouldLoadHistory).toBe(true);
  });

  test("keeps a cold running session in loading state while history is in flight", () => {
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
    expect(lifecycle.shouldLoadHistory).toBe(false);
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
    expect(lifecycle.shouldLoadHistory).toBe(false);
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
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      phase: "resolving_runtime",
      canReadRuntimeData: false,
      canRenderHistory: false,
      shouldLoadHistory: false,
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "runtime_waiting",
    });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(true);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(true);
    expect(lifecycle.shouldLoadHistory).toBe(false);
  });

  test("surfaces selected session load failures without a second local state machine", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: "Session history failed",
    });

    expect(lifecycle).toMatchObject({
      phase: "history_failed",
      canReadRuntimeData: false,
      canRenderHistory: false,
      shouldLoadHistory: false,
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "failed" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
    expect(lifecycle.shouldLoadHistory).toBe(false);
  });

  test("delegates selected active session readiness to the session lifecycle", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: createSession({ historyLoadState: "not_requested", messages: [] }),
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      phase: "loading_history",
      canReadRuntimeData: true,
      canRenderHistory: false,
      shouldLoadHistory: true,
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "session_loading",
      reason: "history",
    });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(true);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
    expect(lifecycle.shouldLoadHistory).toBe(true);
  });

  test("keeps a selected task in runtime loading instead of inactive while repo runtime is checking", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      phase: "waiting_for_runtime",
      canReadRuntimeData: false,
      canRenderHistory: false,
      shouldLoadHistory: false,
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "runtime_waiting",
    });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(true);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(true);
  });

  test("keeps sessionless selection inactive once runtime is ready", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle).toMatchObject({
      phase: "inactive",
      canReadRuntimeData: false,
      canRenderHistory: false,
      shouldLoadHistory: false,
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "empty" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
  });
});
