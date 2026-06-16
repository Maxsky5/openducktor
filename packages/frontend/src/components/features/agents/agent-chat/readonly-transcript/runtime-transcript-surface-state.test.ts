import { describe, expect, test } from "bun:test";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";

const baseInput = {
  isOpen: true,
  hasWorkspace: true,
  hasTarget: true,
  hasSession: false,
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

  test("does not expose an empty state while a session is displayed", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        hasSession: true,
        transcriptState: { kind: "visible" },
      }).emptyState,
    ).toBeNull();
  });
});
