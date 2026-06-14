import { describe, expect, test } from "bun:test";
import { getAgentChatThreadState } from "./agent-chat-thread-state";

const readyLifecycle = {
  phase: "ready" as const,
  canRenderHistory: true,
  historyRequest: "none" as const,
};

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
      sessionLifecycle: {
        phase: "waiting_for_runtime",
        canRenderHistory: false,
        historyRequest: "none",
      },
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "checking",
        isReady: false,
        isRuntimeStarting: true,
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.statusOverlay?.kind).toBe("runtime_waiting");
    expect(state.statusOverlay?.title).toBe("Runtime is starting");
    expect(state.hideTranscriptWhileDeferred).toBe(false);
    expect(state.isTranscriptLoading).toBe(false);
  });

  test("treats history load as conversation-loading state", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: {
        phase: "loading_history",
        canRenderHistory: false,
        historyRequest: "none",
      },
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(state.isTranscriptLoading).toBe(true);
    expect(state.hideTranscriptWhileDeferred).toBe(false);
    expect(state.statusOverlay?.kind).toBe("session_loading");
    expect(state.statusOverlay?.description).toBe("Loading the selected conversation.");
  });

  test("treats session context switching as view preparation", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: readyLifecycle,
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: true,
      isTranscriptRenderDeferred: false,
    });

    expect(state.isTranscriptLoading).toBe(true);
    expect(state.statusOverlay?.kind).toBe("session_loading");
    expect(state.statusOverlay?.description).toBe("Preparing the selected session view.");
  });

  test("treats missing transcript rows as conversation-loading state", () => {
    const state = getAgentChatThreadState({
      sessionLifecycle: readyLifecycle,
      runtimeReadiness: readyRuntimeReadiness,
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
      isTranscriptRowsMissing: true,
    });

    expect(state.isTranscriptLoading).toBe(true);
    expect(state.hideTranscriptWhileDeferred).toBe(false);
    expect(state.statusOverlay?.kind).toBe("session_loading");
    expect(state.statusOverlay?.description).toBe("Loading the selected conversation.");
  });

  test("shows blocked card only for explicit blocked reason", () => {
    const visible = getAgentChatThreadState({
      sessionLifecycle: readyLifecycle,
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
      sessionLifecycle: readyLifecycle,
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "",
      },
      isSessionContextSwitching: false,
      isTranscriptRenderDeferred: false,
    });

    expect(visible.showRuntimeBlockedCard).toBe(true);
    expect(hidden.showRuntimeBlockedCard).toBe(false);
  });
});
