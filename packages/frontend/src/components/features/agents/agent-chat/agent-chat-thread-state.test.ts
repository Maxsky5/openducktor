import { describe, expect, test } from "bun:test";
import { buildThreadLifecycle } from "./agent-chat-test-fixtures";
import { getAgentChatThreadState } from "./agent-chat-thread-state";

const readyLifecycle = buildThreadLifecycle();

const readyRuntimeReadiness = {
  readinessState: "ready" as const,
  isReady: true,
  isRuntimeStarting: false,
  blockedReason: "",
  isLoadingChecks: false,
  refreshChecks: async () => {},
};

describe("getAgentChatThreadState", () => {
  test("keeps runtime waiting separate from conversation hiding", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "waiting_for_runtime",
        repoReadinessState: "checking",
      }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.transcriptNotice?.kind).toBe("runtime_waiting");
    expect(state.transcriptNotice?.title).toBe("Runtime is starting");
    expect(state.hideTranscriptRows).toBe(false);
  });

  test("treats history load as conversation-loading state", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "loading_history",
        repoReadinessState: "ready",
      }),
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.hideTranscriptRows).toBe(false);
    expect(state.shouldResetTranscriptWindow).toBe(true);
    expect(state.transcriptNotice?.kind).toBe("session_loading");
    expect(state.transcriptNotice?.description).toBe("Loading the selected conversation.");
  });

  test("does not present local context switching as session loading", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: readyLifecycle,
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: true,
      isTranscriptRenderDeferred: false,
    });

    expect(state.shouldResetTranscriptWindow).toBe(true);
    expect(state.transcriptNotice).toBeNull();
  });

  test("does not present missing transcript rows as session loading", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: readyLifecycle,
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
      isTranscriptRowsMissing: true,
    });

    expect(state.hideTranscriptRows).toBe(false);
    expect(state.shouldResetTranscriptWindow).toBe(true);
    expect(state.transcriptNotice).toBeNull();
  });

  test("surfaces failed selected-session history as a transcript notice", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "history_failed",
        repoReadinessState: "ready",
      }),
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
    });
  });

  test("does not let blocked runtime readiness hide a renderable transcript", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "refreshing_history",
        repoReadinessState: "ready",
      }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.transcriptNotice).toBe(null);
    expect(state.hideTranscriptRows).toBe(false);
    expect(state.shouldResetTranscriptWindow).toBe(false);
  });

  test("keeps history failures distinct from runtime readiness failures", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "history_failed",
        repoReadinessState: "ready",
      }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
    });
  });

  test("shows blocked runtime notice only when no transcript can render", () => {
    const visible = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "waiting_for_runtime",
        repoReadinessState: "blocked",
      }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });
    const hidden = getAgentChatThreadState({
      sessionLifecycle: buildThreadLifecycle({
        phase: "waiting_for_runtime",
        repoReadinessState: "blocked",
      }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "",
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(visible.transcriptNotice).toEqual({
      kind: "runtime_blocked",
      title: "Runtime unavailable",
      description: "Runtime unavailable",
    });
    expect(hidden.transcriptNotice?.kind).toBe("runtime_waiting");
  });
});
