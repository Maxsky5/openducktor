import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  deriveAgentSessionTargetViewLifecycle,
  deriveAgentSessionViewLifecycle,
  deriveSelectedAgentSessionViewLifecycle,
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
  test("keeps a partial transcript visible while history has not loaded", () => {
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
  });

  test("keeps a transcript visible after a prior history failure", () => {
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
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

    expect(lifecycle.transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
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

    expect(lifecycle.transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
  });

  test("keeps a local outbound send visible while pending", () => {
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

    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
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

    expect(lifecycle.repoReadinessState).toBe("checking");
    expect(lifecycle.transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("uses visible transcript messages when history is loaded", () => {
    const lifecycle = deriveAgentSessionTargetViewLifecycle({
      target: {
        historyLoadState: "loaded",
        hasTranscript: true,
      },
      repoReadinessState: "ready",
    });

    expect(lifecycle.repoReadinessState).toBe("ready");
    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
  });

  test("stays inactive when there is no transcript target", () => {
    const lifecycle = deriveAgentSessionTargetViewLifecycle({
      target: null,
      repoReadinessState: "ready",
    });

    expect(lifecycle.repoReadinessState).toBe("ready");
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

    expect(lifecycle.transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("surfaces selected session load failures without a second local state machine", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: "Session history failed",
    });

    expect(lifecycle.transcriptState).toEqual({ kind: "failed" });
  });

  test("delegates selected active session readiness to the session lifecycle", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute,
      session: createSession({ historyLoadState: "not_requested", messages: [] }),
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle.transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
  });

  test("keeps a selected task in runtime loading instead of inactive while repo runtime is checking", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionLoadError: null,
    });

    expect(lifecycle.transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("waits for runtime readiness before resolving the loading session read model", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionLoadError: null,
      isLoadingSessionReadModel: true,
    });

    expect(lifecycle.transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("resolves selected sessions through the lifecycle owner once runtime is ready", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
      isLoadingSessionReadModel: true,
    });

    expect(lifecycle.transcriptState).toEqual({
      kind: "session_loading",
      reason: "preparing",
    });
  });

  test("keeps sessionless selection inactive once runtime is ready", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionRoute: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle.transcriptState).toEqual({ kind: "empty" });
  });
});
