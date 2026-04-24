import { describe, expect, mock, test } from "bun:test";
import { executeSessionStart, prepareSessionStartInput } from "./session-start-execution";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

describe("session-start-execution", () => {
  test("prepareSessionStartInput keeps reuse starts free of selection-only fields", async () => {
    const result = await prepareSessionStartInput({
      taskId: "TASK-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      startMode: "reuse",
      sourceSessionId: "session-build-1",
    });

    expect(result).toEqual({
      taskId: "TASK-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      startMode: "reuse",
      sourceSessionId: "session-build-1",
    });
  });

  test("prepareSessionStartInput keeps fresh starts free of repo resolution", async () => {
    const result = await prepareSessionStartInput({
      taskId: "TASK-1",
      role: "qa",
      scenario: "qa_review",
      startMode: "fresh",
      selectedModel: BUILD_SELECTION,
    });

    expect(result).toEqual({
      taskId: "TASK-1",
      role: "qa",
      scenario: "qa_review",
      selectedModel: BUILD_SELECTION,
      startMode: "fresh",
    });
  });

  test("executeSessionStart syncs selected model only for non-reuse starts", async () => {
    const startAgentSession = mock(async () => "session-new");

    await executeSessionStart({
      taskId: "TASK-1",
      role: "spec",
      scenario: "spec_initial",
      startMode: "fresh",
      selectedModel: BUILD_SELECTION,
      startAgentSession,
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: BUILD_SELECTION,
      }),
    );

    await executeSessionStart({
      taskId: "TASK-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      startMode: "reuse",
      sourceSessionId: "session-build-1",
      startAgentSession,
    });

    expect(startAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startMode: "reuse",
        sourceSessionId: "session-build-1",
      }),
    );
  });
});
