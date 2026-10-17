import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { extractLatestSessionContextUsage } from "./context-usage-resolution";

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [],
};

describe("context-usage-resolution", () => {
  test("uses the latest host-owned live context usage", () => {
    expect(
      extractLatestSessionContextUsage({
        liveContextUsage: {
          totalTokens: 44,
          contextWindow: 150_000,
          outputLimit: 4_096,
        },
        catalog: CATALOG,
      }),
    ).toEqual({ totalTokens: 44, contextWindow: 150_000, outputLimit: 4_096 });
  });

  test("resolves missing limits from the live model identity", () => {
    expect(
      extractLatestSessionContextUsage({
        liveContextUsage: {
          totalTokens: 44,
          providerId: "openai",
          modelId: "gpt-5",
        },
        catalog: CATALOG,
      }),
    ).toEqual({ totalTokens: 44, contextWindow: 200_000, outputLimit: 8_192 });
  });

  test("resolves missing limits from a resolved model ID of an alias entry", () => {
    expect(
      extractLatestSessionContextUsage({
        liveContextUsage: {
          totalTokens: 44,
          providerId: "openai",
          modelId: "gpt-5-2026-08-01",
        },
        catalog: {
          ...CATALOG,
          models: CATALOG.models.map((model) => ({
            ...model,
            resolvedModelId: "gpt-5-2026-08-01",
          })),
        },
      }),
    ).toEqual({ totalTokens: 44, contextWindow: 200_000, outputLimit: 8_192 });
  });

  test("uses selected-model limits only when live usage omits them", () => {
    expect(
      extractLatestSessionContextUsage({
        liveContextUsage: { totalTokens: 31 },
        catalog: null,
        fallbackContextWindow: 100_000,
        fallbackOutputLimit: 4_096,
      }),
    ).toEqual({ totalTokens: 31, contextWindow: 100_000, outputLimit: 4_096 });
  });

  test("does not derive usage from transcript history", () => {
    expect(
      extractLatestSessionContextUsage({
        catalog: CATALOG,
        fallbackContextWindow: 100_000,
      }),
    ).toBeNull();
  });
});
