import { describe, expect, test } from "bun:test";
import { CodexModels, toCatalog } from "./model-catalog";
import type { CodexAppServerClient, CodexModelListResponse } from "./types";

const createModelListResponse = (inputModalities: string[]): CodexModelListResponse => ({
  data: [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "GPT-5 model",
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
      defaultReasoningEffort: "medium",
      inputModalities,
      supportsPersonality: true,
      isDefault: true,
      serviceTiers: [],
    },
  ],
  nextCursor: null,
});

describe("Codex model catalog mapping", () => {
  test("maps advertised service tiers above default to speed levels", () => {
    const response = createModelListResponse(["text"]);
    response.data[0]!.serviceTiers = [
      { id: "default", name: "Standard", description: "Standard processing" },
      { id: "priority", name: "Fast", description: "Fast processing" },
    ];

    expect(toCatalog(response).models[0]?.speedLevels).toEqual([
      { id: "priority", label: "Fast", description: "Fast processing" },
    ]);
    expect(toCatalog(createModelListResponse(["text"])).models[0]?.speedLevels).toBeUndefined();
  });

  test("maps Codex image input modality to image attachment support", () => {
    const catalog = toCatalog(createModelListResponse(["text", "image"]));

    expect(catalog.models[0]?.attachmentSupport).toEqual({
      image: true,
      audio: false,
      video: false,
      pdf: false,
    });
  });

  test("does not advertise image attachment support for text-only Codex models", () => {
    const catalog = toCatalog(createModelListResponse(["text"]));

    expect(catalog.models[0]?.attachmentSupport).toEqual({
      image: false,
      audio: false,
      video: false,
      pdf: false,
    });
  });

  test("rejects a speed that the model does not advertise", async () => {
    const response = createModelListResponse(["text"]);
    response.data[0]!.serviceTiers = [{ id: "priority", name: "Fast", description: "Fast" }];
    const client: CodexAppServerClient = { modelList: async () => response };
    const model = { providerId: "codex", modelId: "gpt-5" };

    await expect(
      new CodexModels().validate(client, "runtime", { ...model, speed: "priority" }),
    ).resolves.toBeUndefined();
    await expect(
      new CodexModels().validate(client, "runtime", { ...model, speed: "flex" }),
    ).rejects.toThrow("does not support service tier 'flex'");
  });
});
