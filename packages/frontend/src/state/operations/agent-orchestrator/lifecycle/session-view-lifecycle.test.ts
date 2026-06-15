import { describe, expect, test } from "bun:test";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  deriveAgentSessionTranscriptLifecycle,
  deriveSelectedAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "./session-view-lifecycle";

type CreateSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const createSession = (overrides: CreateSessionOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "external-1";

  return {
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-02-22T08:00:00.000Z",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    historyLoadState: "not_requested",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
  };
};

const selectedSessionIdentity = {
  externalSessionId: "external-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo/worktree",
};

const deriveSelectedSessionLifecycleForSession = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: SessionRepoReadinessState;
}) =>
  deriveSelectedAgentSessionViewLifecycle({
    selectedSessionIdentity,
    session,
    hasSelectedTask: true,
    repoReadinessState,
    sessionLoadError: null,
  });

describe("deriveSelectedAgentSessionViewLifecycle for loaded sessions", () => {
  test("keeps a partial transcript visible while history has not loaded", () => {
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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

  test("surfaces cold history failures when there is no transcript to render", () => {
    const lifecycle = deriveSelectedSessionLifecycleForSession({
      session: createSession({
        historyLoadState: "failed",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(lifecycle.transcriptState).toEqual({ kind: "failed" });
  });

  test("renders running sessions immediately without view readiness loading", () => {
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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
    const lifecycle = deriveSelectedSessionLifecycleForSession({
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

describe("deriveAgentSessionTranscriptLifecycle", () => {
  test("uses history load state for a transcript snapshot before a session exists", () => {
    const lifecycle = deriveAgentSessionTranscriptLifecycle({
      transcript: {
        historyLoadState: "loading",
        hasTranscript: false,
      },
      repoReadinessState: "checking",
    });

    expect(lifecycle.repoReadinessState).toBe("checking");
    expect(lifecycle.transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("uses visible transcript messages when history is loaded", () => {
    const lifecycle = deriveAgentSessionTranscriptLifecycle({
      transcript: {
        historyLoadState: "loaded",
        hasTranscript: true,
      },
      repoReadinessState: "ready",
    });

    expect(lifecycle.repoReadinessState).toBe("ready");
    expect(lifecycle.transcriptState).toEqual({ kind: "visible" });
  });

  test("stays inactive when there is no transcript snapshot", () => {
    const lifecycle = deriveAgentSessionTranscriptLifecycle({
      transcript: null,
      repoReadinessState: "ready",
    });

    expect(lifecycle.repoReadinessState).toBe("ready");
  });
});

describe("deriveSelectedAgentSessionViewLifecycle", () => {
  test("keeps a missing selected session loading while runtime readiness is checking", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionIdentity,
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
      selectedSessionIdentity,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: "Session history failed",
    });

    expect(lifecycle.transcriptState).toEqual({ kind: "failed" });
  });

  test("delegates selected active session readiness to the session lifecycle", () => {
    const lifecycle = deriveSelectedAgentSessionViewLifecycle({
      selectedSessionIdentity,
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
      selectedSessionIdentity: null,
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
      selectedSessionIdentity: null,
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
      selectedSessionIdentity: null,
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
      selectedSessionIdentity: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionLoadError: null,
    });

    expect(lifecycle.transcriptState).toEqual({ kind: "empty" });
  });
});
