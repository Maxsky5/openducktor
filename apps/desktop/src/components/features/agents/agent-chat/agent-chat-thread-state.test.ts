import { describe, expect, test } from "bun:test";
import { getAgentChatThreadState } from "./agent-chat-thread-state";

describe("getAgentChatThreadState", () => {
  test("keeps runtime waiting separate from transcript hiding", () => {
    const state = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: false,
      isWaitingForRuntimeReadiness: true,
      readinessState: "checking",
      blockedReason: "",
      isTranscriptRenderDeferred: false,
    });

    expect(state.showRuntimeCheckingOverlay).toBe(true);
    expect(state.hideTranscriptWhileHydrating).toBe(false);
    expect(state.isTranscriptLoading).toBe(false);
  });

  test("treats history hydration as transcript-loading state", () => {
    const state = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: true,
      isWaitingForRuntimeReadiness: false,
      readinessState: "ready",
      blockedReason: "",
      isTranscriptRenderDeferred: false,
    });

    expect(state.isTranscriptLoading).toBe(true);
    expect(state.hideTranscriptWhileHydrating).toBe(true);
    expect(state.showRuntimeCheckingOverlay).toBe(false);
  });

  test("shows blocked card only for explicit blocked reason", () => {
    const visible = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: false,
      isWaitingForRuntimeReadiness: false,
      readinessState: "blocked",
      blockedReason: "Runtime unavailable",
      isTranscriptRenderDeferred: false,
    });
    const hidden = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: false,
      isWaitingForRuntimeReadiness: false,
      readinessState: "blocked",
      blockedReason: "",
      isTranscriptRenderDeferred: false,
    });

    expect(visible.showRuntimeBlockedCard).toBe(true);
    expect(hidden.showRuntimeBlockedCard).toBe(false);
  });
});
