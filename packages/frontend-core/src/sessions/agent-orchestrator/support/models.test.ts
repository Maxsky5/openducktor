import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  coerceSessionSelectionToCatalog,
  normalizePersistedSelection,
  pickDefaultSessionSelectionForCatalog,
} from "./models";

const catalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
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
  test("picks and coerces session selections against the catalog", () => {
    expect(pickDefaultSessionSelectionForCatalog(catalogFixture)).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });

    expect(
      coerceSessionSelectionToCatalog(catalogFixture, {
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
