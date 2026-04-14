import { describe, expect, test } from "bun:test";
import {
  normalizeRepoAgentDefaultForSave,
  repoAgentDefaultRuntimeKindError,
} from "./repo-agent-defaults";

describe("repo-agent-defaults", () => {
  test("normalizes configured agent defaults for save", () => {
    expect(
      normalizeRepoAgentDefaultForSave("spec", {
        runtimeKind: " opencode ",
        providerId: " openai ",
        modelId: " gpt-5 ",
        variant: " mini ",
        profileId: " spec ",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "mini",
      profileId: "spec",
    });
  });

  test("drops incomplete agent defaults when provider or model is blank", () => {
    expect(
      normalizeRepoAgentDefaultForSave("planner", {
        runtimeKind: "opencode",
        providerId: " ",
        modelId: "gpt-5",
      }),
    ).toBeUndefined();

    expect(
      normalizeRepoAgentDefaultForSave("planner", {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: " ",
      }),
    ).toBeUndefined();
  });

  test("rejects missing runtime kind when provider and model are configured", () => {
    expect(() =>
      normalizeRepoAgentDefaultForSave("build", {
        runtimeKind: " ",
        providerId: "anthropic",
        modelId: "claude-4",
      }),
    ).toThrow(repoAgentDefaultRuntimeKindError("build"));
  });
});
