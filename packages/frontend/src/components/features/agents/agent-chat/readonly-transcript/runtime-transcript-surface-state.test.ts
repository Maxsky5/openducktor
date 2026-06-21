import { describe, expect, test } from "bun:test";
import { deriveRuntimeTranscriptSurfaceState } from "./runtime-transcript-surface-state";

const baseInput = {
  transcriptState: { kind: "empty" as const, reason: "unavailable" as const },
  chatSettingsError: null,
};

describe("deriveRuntimeTranscriptSurfaceState", () => {
  test("surfaces history load errors", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        transcriptState: { kind: "failed", message: "history unavailable" },
      }).emptyState,
    ).toEqual({
      title: "Failed to load conversation: history unavailable",
    });
  });

  test("surfaces chat settings load errors before history errors", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        transcriptState: { kind: "failed", message: "history unavailable" },
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
        transcriptState: { kind: "empty", reason: "inactive" },
      }).emptyState,
    ).toEqual({
      title: "Select a repository and session to view the conversation.",
    });
  });

  test("does not expose an empty state while a session is displayed", () => {
    expect(
      deriveRuntimeTranscriptSurfaceState({
        ...baseInput,
        transcriptState: { kind: "visible" },
      }).emptyState,
    ).toBeNull();
  });
});
