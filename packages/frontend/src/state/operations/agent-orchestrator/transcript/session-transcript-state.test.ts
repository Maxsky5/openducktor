import { describe, expect, test } from "bun:test";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import {
  deriveLoadedAgentSessionTranscriptState,
  derivePendingSelectedSessionTranscriptState,
  deriveRuntimeBoundTranscriptEmptyState,
  deriveRuntimeBoundTranscriptLoadingState,
  deriveSessionlessTaskTranscriptState,
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
  deriveLoadedAgentSessionTranscriptState({
    session,
    repoReadinessState,
  });

describe("deriveLoadedAgentSessionTranscriptState", () => {
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

describe("runtime-bound transcript state", () => {
  test("waits for runtime readiness before surfacing runtime-backed empty states", () => {
    const transcriptState = deriveRuntimeBoundTranscriptEmptyState({
      reason: "sessionless",
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("surfaces runtime-backed empty states after runtime readiness", () => {
    const transcriptState = deriveRuntimeBoundTranscriptEmptyState({
      reason: "sessionless",
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "empty", reason: "sessionless" });
  });

  test("waits for runtime readiness before surfacing history loading", () => {
    const transcriptState = deriveRuntimeBoundTranscriptLoadingState({
      reason: "history",
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("surfaces history loading once runtime is ready", () => {
    const transcriptState = deriveRuntimeBoundTranscriptLoadingState({
      reason: "history",
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "history" });
  });

  test("surfaces preparing loading once runtime is ready", () => {
    const transcriptState = deriveRuntimeBoundTranscriptLoadingState({
      reason: "preparing",
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });
});

describe("read-model-bound transcript state", () => {
  test("keeps selected sessions waiting on runtime readiness before preparing", () => {
    const transcriptState = derivePendingSelectedSessionTranscriptState({
      readModelLoadState: readyAgentSessionReadModelLoadState("/tmp/repo"),
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("shows selected-session preparation once runtime is ready", () => {
    const transcriptState = derivePendingSelectedSessionTranscriptState({
      readModelLoadState: readyAgentSessionReadModelLoadState("/tmp/repo"),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("surfaces selected-session read-model failures", () => {
    const transcriptState = derivePendingSelectedSessionTranscriptState({
      readModelLoadState: failedAgentSessionReadModelLoadState("/tmp/repo", "Session read failed"),
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "failed", message: "Session read failed" });
  });

  test("keeps sessionless tasks waiting on runtime while the read model loads", () => {
    const transcriptState = deriveSessionlessTaskTranscriptState({
      readModelLoadState: loadingAgentSessionReadModelLoadState("/tmp/repo"),
      repoReadinessState: "checking",
    });

    expect(transcriptState).toEqual({ kind: "runtime_waiting" });
  });

  test("shows sessionless task preparation while the ready runtime read model loads", () => {
    const transcriptState = deriveSessionlessTaskTranscriptState({
      readModelLoadState: loadingAgentSessionReadModelLoadState("/tmp/repo"),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "session_loading", reason: "preparing" });
  });

  test("shows sessionless empty state after the read model is ready", () => {
    const transcriptState = deriveSessionlessTaskTranscriptState({
      readModelLoadState: readyAgentSessionReadModelLoadState("/tmp/repo"),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "empty", reason: "sessionless" });
  });

  test("surfaces sessionless task read-model failures", () => {
    const transcriptState = deriveSessionlessTaskTranscriptState({
      readModelLoadState: failedAgentSessionReadModelLoadState("/tmp/repo", "Session list failed"),
      repoReadinessState: "ready",
    });

    expect(transcriptState).toEqual({ kind: "failed", message: "Session list failed" });
  });
});
