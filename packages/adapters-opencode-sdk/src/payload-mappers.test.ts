import { describe, expect, test } from "bun:test";
import {
  mapProviderListToCatalog,
  normalizeModelInput,
  resolveAssistantResponseMessageId,
  toToolIdList,
} from "./payload-mappers";

describe("payload-mappers", () => {
  test("normalizeModelInput maps model selection to SDK shape", () => {
    const mapped = normalizeModelInput({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "hephaestus",
    });

    expect(mapped).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
      agent: "hephaestus",
    });
  });

  test("resolveAssistantResponseMessageId falls back from info.id to part.messageID", () => {
    const fromInfo = resolveAssistantResponseMessageId({
      info: { id: "assistant-info-id" },
      parts: [{ messageID: "assistant-part-id" }],
    });
    const fromPart = resolveAssistantResponseMessageId({
      parts: [{ messageID: "assistant-part-id" }],
    });

    expect(fromInfo).toBe("assistant-info-id");
    expect(fromPart).toBe("assistant-part-id");
  });

  test("toToolIdList trims entries and filters invalid values", () => {
    const ids = toToolIdList([" odt_read_task ", "", "invalid", "custom_tool"]);
    expect(ids).toEqual(["odt_read_task", "custom_tool"]);
  });

  test("mapProviderListToCatalog converts provider payload", () => {
    const catalog = mapProviderListToCatalog({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5": {
              name: "GPT-5",
              limit: {
                context: 200_000,
                output: 32_000,
              },
              variants: {
                high: {},
                low: {},
              },
            },
          },
        },
      ],
      default: {
        openai: "gpt-5",
      },
    });

    expect(catalog.defaultModelsByProvider).toEqual({ openai: "gpt-5" });
    expect(catalog.models).toEqual([
      {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
        variants: ["high", "low"],
        contextWindow: 200_000,
        outputLimit: 32_000,
      },
    ]);
  });
});
