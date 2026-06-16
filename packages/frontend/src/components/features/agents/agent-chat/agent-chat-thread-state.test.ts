import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
import {
  deriveAgentChatThreadProjection,
  getAgentChatThreadState,
} from "./agent-chat-thread-state";

const readyTranscriptState = buildThreadTranscriptState();

const readyRuntimeReadiness = {
  readinessState: "ready" as const,
  isReady: true,
  isRuntimeStarting: false,
  blockedReason: "",
  isLoadingChecks: false,
  refreshChecks: async () => {},
};

describe("getAgentChatThreadState", () => {
  test("keeps the session renderable when the transcript is visible", () => {
    const session = buildSession({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });
    const projection = deriveAgentChatThreadProjection({
      session,
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
    });

    expect(projection.threadSession).toEqual(session);
    expect(projection.activeSessionKey).toBe(agentSessionIdentityKey(session));
  });

  test("hides the session and marks the transcript pending while lifecycle is loading", () => {
    const session = buildSession();
    const projection = deriveAgentChatThreadProjection({
      session,
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.activeSessionKey).toBeNull();
  });

  test("hides the session without pending state when lifecycle failed", () => {
    const session = buildSession();
    const projection = deriveAgentChatThreadProjection({
      session,
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.activeSessionKey).toBeNull();
  });

  test("keeps runtime waiting separate from conversation hiding", () => {
    const state = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
      },
    });

    expect(state.transcriptNotice?.kind).toBe("runtime_waiting");
    expect(state.transcriptNotice?.severity).toBe("loading");
    expect(state.transcriptNotice?.title).toBe("Runtime is starting");
  });

  test("treats history load as conversation-loading state", () => {
    const state = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.shouldResetTranscriptWindow).toBe(true);
    expect(state.transcriptNotice?.kind).toBe("session_loading");
    expect(state.transcriptNotice?.severity).toBe("loading");
    expect(state.transcriptNotice?.description).toBe("Loading the selected conversation.");
  });

  test("does not reset the transcript window for a visible lifecycle", () => {
    const state = getAgentChatThreadState({
      transcriptState: readyTranscriptState,
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.shouldResetTranscriptWindow).toBe(false);
    expect(state.transcriptNotice).toBeNull();
  });

  test("surfaces failed selected-session history as a transcript notice", () => {
    const state = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      severity: "error",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
    });
  });

  test("does not let blocked runtime readiness hide a renderable transcript", () => {
    const state = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
    });

    expect(state.transcriptNotice).toBe(null);
    expect(state.shouldResetTranscriptWindow).toBe(false);
  });

  test("keeps history failures distinct from runtime readiness failures", () => {
    const state = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      severity: "error",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
    });
  });

  test("shows blocked runtime notice only when no transcript can render", () => {
    const visible = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "Runtime unavailable",
      },
    });
    const hidden = getAgentChatThreadState({
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        readinessState: "blocked",
        isReady: false,
        blockedReason: "",
      },
    });

    expect(visible.transcriptNotice).toEqual({
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: "Runtime unavailable",
    });
    expect(hidden.transcriptNotice?.kind).toBe("runtime_waiting");
  });
});
