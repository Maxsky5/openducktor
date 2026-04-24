import { describe, expect, test } from "bun:test";
import { getAgentChatThreadState } from "./agent-chat-thread-state";

describe("getAgentChatThreadState", () => {
  test("keeps runtime waiting separate from conversation hiding", () => {
    const state = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: false,
      isWaitingForRuntimeReadiness: true,
      readinessState: "checking",
      blockedReason: "",
      isTranscriptRenderDeferred: false,
    });

    expect(state.statusOverlay?.kind).toBe("runtime_waiting");
    expect(state.statusOverlay?.title).toBe("Runtime is starting");
    expect(state.hideTranscriptWhileDeferred).toBe(false);
    expect(state.isTranscriptLoading).toBe(false);
  });

  test("treats history hydration as conversation-loading state", () => {
    const state = getAgentChatThreadState({
      isSessionViewLoading: false,
      isSessionHistoryLoading: true,
      isWaitingForRuntimeReadiness: false,
      readinessState: "ready",
      blockedReason: "",
      isTranscriptRenderDeferred: false,
    });

    expect(state.isTranscriptLoading).toBe(true);
    expect(state.hideTranscriptWhileDeferred).toBe(false);
    expect(state.statusOverlay?.kind).toBe("session_loading");
    expect(state.statusOverlay?.description).toBe("Loading the selected conversation.");
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
