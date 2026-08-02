import { describe, expect, test } from "bun:test";
import { deriveAgentChatRuntimeState } from "@/lib/agent-chat-runtime-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
import { projectAgentChatThreadState } from "./agent-chat-thread-state";

const readyRuntimeReadiness = {
  state: "ready" as const,
  message: null,
  isLoadingChecks: false,
  refreshChecks: async () => {},
};

const historyFailure = {
  code: "invalid_runtime_response" as const,
  summary: "Codex returned invalid conversation history.",
  detail: "Codex thread/turns/list response data[0] must be an object",
  diagnosticId: "diagnostic-1",
  method: "thread/turns/list",
  pageCursor: null,
};

describe("projectAgentChatThreadState", () => {
  test("passes caller-owned transcript inputs through unchanged", () => {
    const session = buildSession();
    const transcriptTarget = {
      externalSessionId: "external-route",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/routed-worktree",
      sessionScope: {
        kind: "workflow" as const,
        taskId: "opaque-task",
        role: "qa" as const,
      },
    };
    const projection = projectAgentChatThreadState({
      sessionKey: agentSessionIdentityKey(session),
      session,
      transcriptTarget,
      transcriptState: buildThreadTranscriptState({ kind: "visible" }),
      transcriptNotice: null,
    });

    expect(projection.threadSession).toBe(session);
    expect(projection.transcriptTarget).toBe(transcriptTarget);
    expect(projection.shouldResetTranscriptWindow).toBe(false);
  });

  test("hides and resets transcript rows from caller-supplied loading state", () => {
    const session = buildSession();
    const notice = {
      kind: "session_loading" as const,
      severity: "loading" as const,
      title: "Loading archive",
      description: "The caller is loading the selected archive.",
    };
    const projection = projectAgentChatThreadState({
      sessionKey: agentSessionIdentityKey(session),
      session,
      transcriptTarget: session,
      transcriptState: buildThreadTranscriptState({ kind: "session_loading", reason: "history" }),
      transcriptNotice: notice,
    });

    expect(projection.threadSession).toBeNull();
    expect(projection.shouldResetTranscriptWindow).toBe(true);
    expect(projection.transcriptNotice).toBe(notice);
  });
});

describe("deriveAgentChatRuntimeState", () => {
  test("enables interactions when the caller runtime is ready", () => {
    expect(
      deriveAgentChatRuntimeState({
        transcriptState: buildThreadTranscriptState({ kind: "visible" }),
        runtimeReadiness: readyRuntimeReadiness,
      }),
    ).toEqual({
      interactionEnabled: true,
      transcriptNotice: null,
    });
  });

  test("projects a caller-owned loading notice while the runtime starts", () => {
    const state = deriveAgentChatRuntimeState({
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "checking",
      },
    });

    expect(state.interactionEnabled).toBe(false);
    expect(state.transcriptNotice).toMatchObject({
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
    });
  });

  test("projects an explicit disabled recheck action for blocked runtimes", () => {
    const recheck = () => {};
    const action = {
      label: "Recheck",
      onAction: recheck,
      disabled: true,
      isPending: true,
    };
    const state = deriveAgentChatRuntimeState({
      transcriptState: buildThreadTranscriptState({ kind: "runtime_waiting" }),
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: "Runtime unavailable",
      },
      runtimeBlockedAction: action,
    });

    expect(state.interactionEnabled).toBe(false);
    expect(state.transcriptNotice).toEqual({
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: "Runtime unavailable",
      action,
    });
  });

  test("projects an explicit retry action for failed transcript loading", () => {
    const retry = () => {};
    const state = deriveAgentChatRuntimeState({
      transcriptState: buildThreadTranscriptState({ kind: "failed", message: "History failed" }),
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
      description: "History failed",
      action: {
        label: "Retry",
        onAction: retry,
      },
    });
  });

  test("surfaces failed selected-session history with diagnostic details", () => {
    const state = deriveAgentChatRuntimeState({
      transcriptState: buildThreadTranscriptState({
        kind: "failed",
        message: historyFailure.summary,
        historyFailure,
      }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_failed",
      severity: "error",
      title: "Couldn't load conversation history",
      description: "Codex returned invalid conversation history.",
      details: [
        { label: "Error", value: historyFailure.detail },
        { label: "Method", value: "thread/turns/list" },
        { label: "Page cursor", value: "First page" },
        { label: "Diagnostic ID", value: "diagnostic-1" },
      ],
    });
  });

  test("keeps an incomplete-history warning for a visible transcript", () => {
    const state = deriveAgentChatRuntimeState({
      transcriptState: buildThreadTranscriptState({ kind: "visible", historyFailure }),
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(state.transcriptNotice).toEqual({
      kind: "session_history_warning",
      severity: "error",
      title: "History may be incomplete",
      description: "Codex returned invalid conversation history.",
      details: [
        { label: "Error", value: historyFailure.detail },
        { label: "Method", value: "thread/turns/list" },
        { label: "Page cursor", value: "First page" },
        { label: "Diagnostic ID", value: "diagnostic-1" },
      ],
    });
  });
});
