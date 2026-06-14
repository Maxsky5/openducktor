import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  canReadAgentSessionRuntimeData,
  deriveAgentSessionTargetViewLifecycle,
  deriveAgentSessionViewLifecycle,
  deriveSelectedAgentSessionViewLifecycle,
  getAgentSessionTranscriptState,
  isSelectedAgentSessionViewLoading,
  isSelectedAgentSessionWaitingForRuntimeReadiness,
  shouldLoadAgentSessionHistory,
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(true);
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(true);
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(canReadAgentSessionRuntimeData(lifecycle)).toBe(true);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
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

    expect(lifecycle.phase).toBe("needs_initial_history");
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "session_loading",
      reason: "history",
    });
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(true);
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "session_loading",
      reason: "history",
    });
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
  });

  test("keeps a renderable transcript stable while history is refreshing", () => {
    const lifecycle = deriveAgentSessionViewLifecycle({
      session: createSession({
        status: "running",
        historyLoadState: "loading",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "already visible",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("refreshing_history");
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
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
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
  });
});

describe("deriveAgentSessionTargetViewLifecycle", () => {
  test("uses history load state for a transcript target before a session exists", () => {
    const lifecycle = deriveAgentSessionTargetViewLifecycle({
      target: {
        historyLoadState: "loading",
        hasTranscript: false,
      },
      repoReadinessState: "checking",
    });

    expect(lifecycle).toEqual({
      phase: "waiting_for_runtime",
      repoReadinessState: "checking",
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "runtime_waiting" });
  });

  test("uses visible transcript messages when history is loaded", () => {
    const lifecycle = deriveAgentSessionTargetViewLifecycle({
      target: {
        historyLoadState: "loaded",
        hasTranscript: true,
      },
      repoReadinessState: "ready",
    });

    expect(lifecycle).toEqual({
      phase: "ready",
      repoReadinessState: "ready",
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "visible" });
  });

  test("stays inactive when there is no transcript target", () => {
    const lifecycle = deriveAgentSessionTargetViewLifecycle({
      target: null,
      repoReadinessState: "ready",
    });

    expect(lifecycle).toEqual({
      phase: "inactive",
      repoReadinessState: "ready",
    });
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
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "runtime_waiting",
    });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(true);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(true);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
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
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "failed" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(false);
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
      phase: "needs_initial_history",
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({
      kind: "session_loading",
      reason: "history",
    });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(true);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
    expect(shouldLoadAgentSessionHistory(lifecycle)).toBe(true);
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
    });
    expect(getAgentSessionTranscriptState(lifecycle)).toEqual({ kind: "empty" });
    expect(isSelectedAgentSessionViewLoading(lifecycle)).toBe(false);
    expect(isSelectedAgentSessionWaitingForRuntimeReadiness(lifecycle)).toBe(false);
  });
});
