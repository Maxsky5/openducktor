import { describe, expect, test } from "bun:test";
import type { Model, Provider } from "@opencode-ai/sdk/v2/client";
import {
  mapProviderListToCatalog,
  normalizeModelInput,
  resolveAssistantResponseMessageId,
  toToolIdList,
} from "./payload-mappers";

const modelFixture = (overrides: Partial<Model> = {}): Model => ({
  api: { id: "model", npm: "@ai-sdk/test", url: "https://example.test" },
  capabilities: {
    attachment: true,
    input: { audio: false, image: true, pdf: false, text: true, video: false },
    interleaved: false,
    output: { audio: false, image: false, pdf: false, text: true, video: false },
    reasoning: true,
    temperature: true,
    toolcall: true,
  },
  cost: { cache: { read: 0, write: 0 }, input: 0, output: 0 },
  headers: {},
  id: "model",
  limit: { context: 200_000, output: 32_000 },
  name: "Model",
  options: {},
  providerID: "provider",
  release_date: "2026-01-01",
  status: "active",
  ...overrides,
});

const providerFixture = (models: Record<string, Model>): Provider => ({
  env: [],
  id: "openai",
  models,
  name: "OpenAI",
  options: {},
  source: "custom",
});

describe("payload-mappers", () => {
  test("normalizeModelInput maps model selection to SDK shape", () => {
    const mapped = normalizeModelInput({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "hephaestus",
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
        providerFixture({
          "gpt-5": modelFixture({
            id: "gpt-5",
            name: "GPT-5",
            providerID: "openai",
            limit: {
              context: 200_000,
              output: 32_000,
            },
            capabilities: {
              ...modelFixture().capabilities,
              input: {
                ...modelFixture().capabilities.input,
                image: true,
                audio: false,
                video: true,
                pdf: false,
              },
            },
            variants: {
              high: {},
              low: {},
            },
          }),
        }),
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
        attachmentSupport: {
          image: true,
          audio: false,
          video: true,
          pdf: false,
        },
        liveSessionUpdates: {
          profile: false,
        },
      },
    ]);
  });

  test("mapProviderListToCatalog reads exact capability flags", () => {
    const catalog = mapProviderListToCatalog({
      providers: [
        {
          ...providerFixture({
            "claude-sonnet": modelFixture({
              id: "claude-sonnet",
              name: "Claude Sonnet",
              providerID: "anthropic",
              capabilities: {
                ...modelFixture().capabilities,
                input: {
                  ...modelFixture().capabilities.input,
                  image: true,
                  pdf: true,
                },
              },
            }),
          }),
          id: "anthropic",
          name: "Anthropic",
        },
      ],
      default: {},
    });

    expect(catalog.models).toEqual([
      {
        id: "anthropic/claude-sonnet",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet",
        modelName: "Claude Sonnet",
        variants: [],
        contextWindow: 200_000,
        outputLimit: 32_000,
        attachmentSupport: {
          image: true,
          audio: false,
          video: false,
          pdf: true,
        },
        liveSessionUpdates: {
          profile: false,
        },
      },
    ]);
  });
});
