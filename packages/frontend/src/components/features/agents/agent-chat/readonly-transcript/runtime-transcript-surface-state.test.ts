import { describe, expect, test } from "bun:test";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";

const baseInput = {
  isOpen: true,
  hasWorkspace: true,
  hasTarget: true,
  session: null,
  transcriptState: { kind: "empty" as const },
  historyError: null,
  chatSettingsError: null,
};

describe("deriveRuntimeTranscriptSurfaceState", () => {
  test("surfaces history load errors", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        transcriptState: { kind: "failed" },
        historyError: "history unavailable",
      }).emptyState,
    ).toEqual({
      title: "Failed to load conversation: history unavailable",
    });
  });

  test("surfaces chat settings load errors before history errors", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        historyError: "history unavailable",
        chatSettingsError: new Error("settings unavailable"),
      }).emptyState,
    ).toEqual({
      title: "Failed to load conversation: Failed to load chat settings: settings unavailable",
    });
  });

  test("does not turn loading transcripts into unavailable conversations", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        transcriptState: { kind: "session_loading", reason: "history" },
      }).emptyState,
    ).toBeNull();
  });

  test("reports an unavailable conversation after a target cannot resolve", () => {
    expect(deriveRuntimeTranscriptSurfaceState(baseInput).emptyState).toEqual({
      title: "Conversation unavailable.",
    });
  });

  test("prompts for a repository and session when no target exists", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        hasTarget: false,
      }).emptyState,
    ).toEqual({
      title: "Select a repository and session to view the conversation.",
    });
  });

  test("derives working state from the displayed session", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        session: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
          title: "Session",
          activityState: "running",
          messages: createSessionMessagesState("session-1"),
          pendingApprovals: [],
          pendingQuestions: [],
          selectedModel: null,
          todos: [],
        },
        transcriptState: { kind: "visible" },
      }).isSessionWorking,
    ).toBe(true);
  });

  test("does not expose an empty state while a session is displayed", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        session: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
          title: "Session",
          activityState: "idle",
          messages: createSessionMessagesState("session-1"),
          pendingApprovals: [],
          pendingQuestions: [],
          selectedModel: null,
          todos: [],
        },
        transcriptState: { kind: "visible" },
      }).emptyState,
    ).toBeNull();
  });
});
