import { describe, expect, test } from "bun:test";
import type { AgentModelSelection } from "@openducktor/core";
import { readFreshSessionRuntimeKind } from "./session-runtime-kind";

describe("readFreshSessionRuntimeKind", () => {
  test("uses role-neutral validation for a missing explicit runtime", () => {
    const selectedModel = {
      providerId: "openai",
      modelId: "gpt-5",
    } as AgentModelSelection;

    expect(() => readFreshSessionRuntimeKind(selectedModel)).toThrow(
      "Runtime kind is required to start a session. Select an explicit runtime before starting.",
    );
  });
});
