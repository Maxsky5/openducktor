import { describe, expect, test } from "bun:test";
import { deriveAgentChatReadiness } from "./agent-chat-readiness";

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

describe("deriveAgentChatReadiness", () => {
  test("enables interactions when the caller runtime is ready", () => {
    expect(
      deriveAgentChatReadiness({
        transcriptState: { kind: "visible" },
        runtimeReadiness: readyRuntimeReadiness,
      }),
    ).toEqual({
      interactionEnabled: true,
      transcriptNotice: null,
    });
  });

  test("projects a caller-owned loading notice while the runtime starts", () => {
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "runtime_waiting" },
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "checking",
      },
    });

    expect(readiness.interactionEnabled).toBe(false);
    expect(readiness.transcriptNotice).toMatchObject({
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
    });
  });

  test("projects session loading separately from runtime startup", () => {
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "session_loading", reason: "history" },
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(readiness.transcriptNotice).toEqual({
      kind: "session_loading",
      severity: "loading",
      title: "Loading session",
      description: "Loading the selected conversation.",
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
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "runtime_waiting" },
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: "Runtime unavailable",
      },
      runtimeBlockedAction: action,
    });

    expect(readiness.interactionEnabled).toBe(false);
    expect(readiness.transcriptNotice).toEqual({
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: "Runtime unavailable",
      action,
    });
  });

  test("keeps a blocked runtime explicit when its source omits the error message", () => {
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "runtime_waiting" },
      runtimeReadiness: {
        ...readyRuntimeReadiness,
        state: "blocked",
        message: null,
      },
    });

    expect(readiness.transcriptNotice).toMatchObject({
      kind: "runtime_blocked",
      severity: "error",
      description: "Runtime readiness is blocked without an error message.",
    });
  });

  test("projects an explicit retry action for failed transcript loading", () => {
    const retry = () => {};
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "failed", message: "History failed" },
      runtimeReadiness: readyRuntimeReadiness,
      failedTranscriptAction: {
        label: "Retry",
        onAction: retry,
      },
    });

    expect(readiness.transcriptNotice).toEqual({
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
    const readiness = deriveAgentChatReadiness({
      transcriptState: {
        kind: "failed",
        message: historyFailure.summary,
        historyFailure,
      },
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(readiness.transcriptNotice).toEqual({
      kind: "session_failed",
      severity: "error",
      title: "Couldn't load conversation history",
      description: historyFailure.summary,
      details: [
        { label: "Error", value: historyFailure.detail },
        { label: "Method", value: historyFailure.method },
        { label: "Page cursor", value: "First page" },
        { label: "Diagnostic ID", value: historyFailure.diagnosticId },
      ],
    });
  });

  test("keeps an incomplete-history warning for a visible transcript", () => {
    const retry = () => {};
    const readiness = deriveAgentChatReadiness({
      transcriptState: { kind: "visible", historyFailure },
      runtimeReadiness: readyRuntimeReadiness,
      failedTranscriptAction: { label: "Retry", onAction: retry },
    });

    expect(readiness.transcriptNotice).toEqual({
      kind: "session_history_warning",
      severity: "error",
      title: "History may be incomplete",
      description: historyFailure.summary,
      details: [
        { label: "Error", value: historyFailure.detail },
        { label: "Method", value: historyFailure.method },
        { label: "Page cursor", value: "First page" },
        { label: "Diagnostic ID", value: historyFailure.diagnosticId },
      ],
      action: { label: "Retry", onAction: retry },
    });
  });

  test("omits unavailable history diagnostics and keeps a real page cursor", () => {
    const readiness = deriveAgentChatReadiness({
      transcriptState: {
        kind: "failed",
        message: "History failed",
        historyFailure: {
          code: "request_failed",
          summary: "History failed",
          detail: "Request failed",
          pageCursor: "cursor-2",
        },
      },
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(readiness.transcriptNotice).toMatchObject({
      details: [
        { label: "Error", value: "Request failed" },
        { label: "Page cursor", value: "cursor-2" },
      ],
    });
  });

  test("omits optional history diagnostics when none are available", () => {
    const readiness = deriveAgentChatReadiness({
      transcriptState: {
        kind: "failed",
        message: "History failed",
        historyFailure: {
          code: "request_failed",
          summary: "History failed",
          detail: "Request failed",
        },
      },
      runtimeReadiness: readyRuntimeReadiness,
    });

    expect(readiness.transcriptNotice).toMatchObject({
      details: [{ label: "Error", value: "Request failed" }],
    });
  });
});
