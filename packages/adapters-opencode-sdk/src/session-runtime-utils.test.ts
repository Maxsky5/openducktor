import { describe, expect, test } from "bun:test";
import { toIsoFromEpoch, toSessionInput } from "./session-runtime-utils";

describe("session-runtime-utils", () => {
  test("toIsoFromEpoch returns ISO for valid epoch", () => {
    const value = toIsoFromEpoch(1_706_171_200_000, () => "fallback");
    expect(value).toBe("2024-01-25T08:26:40.000Z");
  });

  test("toIsoFromEpoch uses fallback for invalid input", () => {
    const value = toIsoFromEpoch(Number.NaN, () => "fallback");
    expect(value).toBe("fallback");
  });

  test("toSessionInput preserves required fields and optional model", () => {
    const withModel = toSessionInput({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "prompt",
      baseUrl: "http://127.0.0.1:12345",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
      },
    });

    const withoutModel = toSessionInput({
      sessionId: "session-2",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-2",
      role: "build",
      scenario: "build_implementation_start",
      systemPrompt: "prompt",
      baseUrl: "http://127.0.0.1:12345",
    });

    expect(withModel.sessionId).toBe("session-1");
    expect(withModel.model?.modelId).toBe("gpt-5");
    expect("model" in withoutModel).toBe(false);
  });
});
