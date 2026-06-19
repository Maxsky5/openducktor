import { describe, expect, test } from "bun:test";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  deriveAgentSessionTranscriptState,
  deriveLoadedAgentSessionTranscriptSource,
} from "./session-transcript-state";

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
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
  };
};

const deriveLoadedTranscriptStateForSession = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}) =>
  deriveAgentSessionTranscriptState({
    source: deriveLoadedAgentSessionTranscriptSource(session),
    repoReadinessState,
  });

describe("deriveLoadedAgentSessionTranscriptSource", () => {
  test("keeps a partial transcript visible while history has not loaded", () => {
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
      session: createSession({
        historyLoadState: "failed",
        messages: [],
      }),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({
      kind: "failed",
      message: "The selected conversation could not be loaded.",
    });
  });

  test("renders running sessions immediately without view readiness loading", () => {
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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
    const transcriptState = deriveLoadedTranscriptStateForSession({
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

describe("deriveAgentSessionTranscriptState", () => {
  test("stays empty without a transcript target", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "empty", reason: "inactive" },
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "empty", reason: "inactive" });
  });

  test("waits for runtime readiness before surfacing runtime-backed empty states", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "runtime_gated_empty", reason: "sessionless" },
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("surfaces runtime-backed empty states after runtime readiness", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "runtime_gated_empty", reason: "sessionless" },
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "empty", reason: "sessionless" });
  });

  test("waits for runtime readiness before surfacing history loading", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "runtime_gated_loading", reason: "history" },
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("surfaces history loading once runtime is ready", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "runtime_gated_loading", reason: "history" },
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "history" });
  });

  test("surfaces preparing loading once runtime is ready", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "runtime_gated_loading", reason: "preparing" },
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("surfaces failures directly", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "failed", message: "read model unavailable" },
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "failed", message: "read model unavailable" });
  });

  test("shows the transcript when a live or history-loaded session exists", () => {
    const transcriptState = deriveAgentSessionTranscriptState({
      source: { kind: "visible" },
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "visible" });
  });
});
