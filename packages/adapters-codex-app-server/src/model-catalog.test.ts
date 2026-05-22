import { describe, expect, test } from "bun:test";
import { toCatalog } from "./model-catalog";
import type { CodexModelListResponse } from "./types";

const createModelListResponse = (inputModalities?: string[]): CodexModelListResponse => ({
  data: [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "GPT-5 model",
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
      defaultReasoningEffort: "medium",
      ...(inputModalities ? { inputModalities } : {}),
      supportsPersonality: true,
      isDefault: true,
    },
  ],
  nextCursor: null,
});

describe("Codex model catalog mapping", () => {
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

  test("uses Codex protocol default modalities for legacy model records", () => {
    const catalog = toCatalog(createModelListResponse());

    expect(catalog.models[0]?.attachmentSupport).toEqual({
      image: true,
      audio: false,
      video: false,
      pdf: false,
    });
  });
});
