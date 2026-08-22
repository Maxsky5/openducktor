import { describe, expect, test } from "bun:test";
import type { AgentModelSelection } from "@openducktor/core";
import { createInvalidFixture } from "@/test-utils/focused-fixture";
import { readFreshSessionRuntimeKind } from "./session-runtime-kind";

describe("readFreshSessionRuntimeKind", () => {
  test("uses role-neutral validation for a missing explicit runtime", () => {
    const selectedModel = createInvalidFixture<AgentModelSelection>({
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(() => readFreshSessionRuntimeKind(selectedModel)).toThrow(
      "Runtime kind is required to start a session. Select an explicit runtime before starting.",
    );
  });

  test("rejects an unsupported explicit runtime", () => {
    const selectedModel = createInvalidFixture<AgentModelSelection>({
      runtimeKind: "unsupported-runtime",
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(() => readFreshSessionRuntimeKind(selectedModel)).toThrow(
      "Unsupported runtime kind 'unsupported-runtime'.",
    );
  });
});
