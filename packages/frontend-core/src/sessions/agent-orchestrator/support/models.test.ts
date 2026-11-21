import { describe, expect, test } from "bun:test";
import { normalizePersistedSelection } from "./models";

describe("agent-orchestrator/support/models", () => {
  test("maps a persisted selection into a runtime session selection", () => {
    expect(
      normalizePersistedSelection({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "low",
        profileId: "xhigh",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "low",
      profileId: "xhigh",
    });
  });
});
