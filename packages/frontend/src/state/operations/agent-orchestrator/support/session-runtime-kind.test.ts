import { describe, expect, test } from "bun:test";
import type { AgentModelSelection } from "@openducktor/core";
import { readFreshSessionRuntimeKind } from "./session-runtime-kind";

describe("readFreshSessionRuntimeKind", () => {
  test("uses role-neutral validation for a missing explicit runtime", () => {
    const selectedModel: AgentModelSelection = {
      providerId: "openai",
      modelId: "gpt-5",
    };

    expect(() => readFreshSessionRuntimeKind(selectedModel)).toThrow(
      "Runtime kind is required to start a session. Select an explicit runtime before starting.",
    );
  });

  test("rejects an unsupported explicit runtime", () => {
    const selectedModel: AgentModelSelection = {
      // @ts-expect-error -- This case verifies runtime rejection of an unsupported runtime kind.
      runtimeKind: "unsupported-runtime",
      providerId: "openai",
      modelId: "gpt-5",
    };

    expect(() => readFreshSessionRuntimeKind(selectedModel)).toThrow(
      "Unsupported runtime kind 'unsupported-runtime'.",
    );
  });
});
