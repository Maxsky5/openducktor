import { describe, expect, test } from "bun:test";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  deriveRuntimeTranscriptState,
  deriveSelectedAgentSessionTranscriptState,
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

const deriveSelectedSessionTranscriptStateForSession = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}) =>
  deriveSelectedAgentSessionTranscriptState({
    selectedSessionIdentity,
    session,
    hasSelectedTask: true,
    repoReadinessState,
    sessionReadModelLoadState: { kind: "idle" },
  });

describe("deriveSelectedAgentSessionTranscriptState for loaded sessions", () => {
  test("keeps a partial transcript visible while history has not loaded", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });

  test("keeps a transcript visible after a prior history failure", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });

  test("surfaces cold history failures when there is no transcript to render", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
      session: createSession({
        historyLoadState: "failed",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "failed" });
  });

  test("renders running sessions immediately without view readiness loading", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });

  test("renders running planner sessions immediately when durable runtime context is available", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });

  test("loads a cold running session transcript before rendering it", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
      session: createSession({
        status: "running",
        historyLoadState: "not_requested",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
  });

  test("keeps a cold running session in loading state while history is in flight", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
      session: createSession({
        status: "running",
        historyLoadState: "loading",
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
  });

  test("keeps a renderable transcript stable while history is refreshing", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });

  test("keeps a local outbound send visible while pending", () => {
    const transcriptState = deriveSelectedSessionTranscriptStateForSession({
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

    expect(transcriptState).toEqual({ kind: "visible" });
  });
});

describe("deriveRuntimeTranscriptState", () => {
  test("stays empty without a transcript target", () => {
    const transcriptState = deriveRuntimeTranscriptState({
      hasVisibleTranscript: false,
      hasHistoryTarget: false,
      hasHistoryFailed: false,
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "empty" });
  });

  test("waits for runtime readiness before surfacing history loading", () => {
    const transcriptState = deriveRuntimeTranscriptState({
      hasVisibleTranscript: false,
      hasHistoryTarget: true,
      hasHistoryFailed: false,
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("surfaces history loading once runtime is ready", () => {
    const transcriptState = deriveRuntimeTranscriptState({
      hasVisibleTranscript: false,
      hasHistoryTarget: true,
      hasHistoryFailed: false,
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "history" });
  });

  test("surfaces history failures through the transcript-state owner", () => {
    const transcriptState = deriveRuntimeTranscriptState({
      hasVisibleTranscript: false,
      hasHistoryTarget: true,
      hasHistoryFailed: true,
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "failed" });
  });

  test("shows the transcript when a live or history-loaded session exists", () => {
    const transcriptState = deriveRuntimeTranscriptState({
      hasVisibleTranscript: true,
      hasHistoryTarget: true,
      hasHistoryFailed: false,
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "visible" });
  });
});

describe("deriveSelectedAgentSessionTranscriptState", () => {
  test("keeps a missing selected session loading while runtime readiness is checking", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionReadModelLoadState: { kind: "idle" },
    });

    expect(transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("surfaces selected session load failures without a second local state machine", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionReadModelLoadState: { kind: "failed", message: "Session history failed" },
    });

    expect(transcriptState).toEqual({ kind: "failed" });
  });

  test("delegates selected active session readiness to the session transcript state", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity,
      session: createSession({ historyLoadState: "not_requested", messages: [] }),
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionReadModelLoadState: { kind: "idle" },
    });

    expect(transcriptState).toEqual({
      kind: "session_loading",
      reason: "history",
    });
  });

  test("keeps a selected task in runtime loading instead of inactive while repo runtime is checking", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionReadModelLoadState: { kind: "idle" },
    });

    expect(transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("waits for runtime readiness before resolving the loading session read model", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "checking",
      sessionReadModelLoadState: { kind: "loading" },
    });

    expect(transcriptState).toEqual({
      kind: "runtime_waiting",
    });
  });

  test("resolves selected sessions through the transcript-state owner once runtime is ready", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionReadModelLoadState: { kind: "loading" },
    });

    expect(transcriptState).toEqual({
      kind: "session_loading",
      reason: "preparing",
    });
  });

  test("keeps sessionless selection inactive once runtime is ready", () => {
    const transcriptState = deriveSelectedAgentSessionTranscriptState({
      selectedSessionIdentity: null,
      session: null,
      hasSelectedTask: true,
      repoReadinessState: "ready",
      sessionReadModelLoadState: { kind: "idle" },
    });

    expect(transcriptState).toEqual({ kind: "empty" });
  });
});
