import { describe, expect, test } from "bun:test";
import { serializeSelectedModelKey } from "./start-session-runtime";

describe("agent-orchestrator/handlers/start-session-runtime", () => {
  test("serializeSelectedModelKey stays stable across all model dimensions", () => {
    expect(
      serializeSelectedModelKey({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "build",
      }),
    ).toBe("opencode::openai::gpt-5::default::build");
  });
});
