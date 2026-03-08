import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  normalizePersistedSelection,
  normalizeSelectionForCatalog,
  pickDefaultModel,
} from "./models";

const catalogFixture: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["high", "low"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [{ name: "xhigh", mode: "all" }],
};

describe("agent-orchestrator/support/models", () => {
  test("picks and normalizes model selections", () => {
    expect(pickDefaultModel(catalogFixture)).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });

    expect(
      normalizeSelectionForCatalog(catalogFixture, {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "missing",
        profileId: "xhigh",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "xhigh",
    });
  });

  test("normalizes persisted selection", () => {
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
