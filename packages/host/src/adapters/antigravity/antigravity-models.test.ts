import { describe, expect, test } from "bun:test";
import { toAntigravityModelCatalog } from "./antigravity-models";

const AGY_MODELS = [
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "gemini-3.8-pro-high\tGemini 3.8 Pro (High)",
  "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
  "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  "",
].join("\n");

describe("toAntigravityModelCatalog", () => {
  test("lists every model of the account with thinking levels as variants and the IDs that ACP accepts", () => {
    const catalog = toAntigravityModelCatalog(AGY_MODELS);

    expect(
      catalog.models.map(({ modelId, modelName, variants }) => [modelId, modelName, variants]),
    ).toEqual([
      ["gemini-3.8-flash", "Gemini 3.8 Flash", ["low", "medium", "high"]],
      // One level alone is a model name, not a choice of levels.
      ["gemini-3.8-pro-high", "Gemini 3.8 Pro (High)", []],
      // ACP offers no thinking level for these models.
      ["claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)", []],
      ["claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", []],
      ["gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", []],
    ]);
    expect(catalog.models.every((model) => model.providerId === "antigravity")).toBe(true);
  });

  test("fails on a line in an unknown format and names the line", () => {
    expect(() => toAntigravityModelCatalog("gemini-3.8-flash Gemini")).toThrow(
      "unknown format: 'gemini-3.8-flash Gemini'",
    );
  });

  test("fails when the account lists no models", () => {
    expect(() => toAntigravityModelCatalog("\n")).toThrow("listed no models");
  });
});
