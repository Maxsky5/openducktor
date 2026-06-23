import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  deriveRepoRuntimeReadiness,
  repoRuntimeReadinessTargetForRuntime,
} from "@/lib/repo-runtime-readiness";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
import { projectAgentChatThreadState } from "./agent-chat-thread-state";

const readyTranscriptState = buildThreadTranscriptState();

const readyRuntimeReadiness = {
  state: "ready" as const,
  message: null,
  isLoadingChecks: false,
  refreshChecks: async () => {},
};

describe("projectAgentChatThreadState", () => {
  test("keeps the session renderable when the transcript is visible", () => {
    const session = buildSession({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });
    const sessionKey = agentSessionIdentityKey(session);
    const projection = projectAgentChatThreadState({
      sessionKey,
      session,
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(projection.threadSession).toEqual(session);
    expect(projection.displayedSessionKey).toBe(sessionKey);
  });

  test("hides existing transcript rows while transcript state is loading", () => {
    const session = buildSession();
    const sessionKey = agentSessionIdentityKey(session);
    const projection = projectAgentChatThreadState({
      sessionKey,
      session,
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.displayedSessionKey).toBe(sessionKey);
    expect(projection.shouldResetTranscriptWindow).toBe(true);
  });

  test("resets the transcript window only when a selected session is loading before session state exists", () => {
    const sessionKey = "session-1|opencode|%2Frepo%2Fworktree";
    const projection = projectAgentChatThreadState({
      sessionKey,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.displayedSessionKey).toBe(sessionKey);
    expect(projection.shouldResetTranscriptWindow).toBe(true);
  });

  test("hides the session without pending state when transcript state failed", () => {
    const session = buildSession();
    const sessionKey = agentSessionIdentityKey(session);
    const projection = projectAgentChatThreadState({
      sessionKey,
      session,
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.displayedSessionKey).toBe(sessionKey);
  });

  test("keeps runtime waiting separate from conversation hiding", () => {
    const session = buildSession();
    const state = projectAgentChatThreadState({
      sessionKey: agentSessionIdentityKey(session),
      session,
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
      },
    });

    expect(state.threadSession).toEqual(session);
    expect(state.shouldResetTranscriptWindow).toBe(false);
    expect(state.transcriptNotice?.kind).toBe("runtime_waiting");
    expect(state.transcriptNotice?.severity).toBe("loading");
    expect(state.transcriptNotice?.title).toBe("Runtime is starting");
  });

  test("treats history load as conversation-loading state", () => {
    const state = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.shouldResetTranscriptWindow).toBe(true);
    expect(state.transcriptNotice?.kind).toBe("session_loading");
    expect(state.transcriptNotice?.severity).toBe("loading");
    expect(state.transcriptNotice?.description).toBe("Loading the selected conversation.");
  });

  test("does not reset the transcript window for a visible transcript state", () => {
    const state = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: readyTranscriptState,
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.shouldResetTranscriptWindow).toBe(false);
    expect(state.transcriptNotice).toBeNull();
  });

  test("surfaces failed selected-session history as a transcript notice", () => {
    const state = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
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

  test("adds an explicit action to failed transcript notices when provided", () => {
    const retry = () => {};
    const state = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
      runtimeReadiness: readyRuntimeReadiness,
      failedTranscriptAction: {
        label: "Retry",
        onAction: retry,
      },
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      severity: "error",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
      action: {
        label: "Retry",
        onAction: retry,
      },
    });
  });

  test("does not let blocked runtime readiness hide a renderable transcript", () => {
    const session = buildSession();
    const state = projectAgentChatThreadState({
      sessionKey: agentSessionIdentityKey(session),
      session,
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: "Runtime unavailable",
      },
    });

    expect(state.transcriptNotice).toBe(null);
    expect(state.shouldResetTranscriptWindow).toBe(false);
  });

  test("keeps history failures distinct from runtime readiness failures", () => {
    const state = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "failed" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: "Runtime unavailable",
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
    const visible = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: "Runtime unavailable",
      },
    });
    const hidden = projectAgentChatThreadState({
      sessionKey: null,
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: null,
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

  test("does not turn automatic not-started runtime readiness into a blocked transcript notice", () => {
    const runtimeReadiness = deriveRepoRuntimeReadiness({
      hasActiveWorkspace: true,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeHealthByRuntime: {
        codex: createRepoRuntimeHealthFixture({
          status: "error",
          runtime: {
            status: "not_started",
            stage: "idle",
            detail: "Runtime has not been started yet.",
          },
          mcp: {
            status: "waiting_for_runtime",
          },
        }),
      },
      isLoadingChecks: false,
      runtimeTarget: repoRuntimeReadinessTargetForRuntime("codex"),
    });

    const state = projectAgentChatThreadState({
      sessionKey: "session-1|codex|%2Frepo%2Fworktree",
      session: null,
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...runtimeReadiness,
        refreshChecks: async () => {},
      },
    });

    expect(runtimeReadiness.state).toBe("checking");
    expect(state.transcriptNotice).toMatchObject({
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
    });
  });
});
