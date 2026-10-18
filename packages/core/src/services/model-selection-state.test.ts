import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentModelCatalog } from "../types/agent-orchestrator";
import { resolveSavedModelAlias } from "./model-catalog-selection";
import { coerceVisibleSelectionToCatalog } from "./model-selection-state";

const model = (modelId: string): AgentModelCatalog["models"][number] => ({
  id: modelId,
  providerId: "claude",
  providerName: "Claude",
  modelId,
  modelName: modelId,
  variants: ["low", "max"],
});

const catalog: AgentModelCatalog = {
  runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
  models: [
    { ...model("claude-opus-5-5"), aliases: ["opus", "claude-opus-5"] },
    model("claude-opus-5"),
  ],
  defaultModelsByProvider: { claude: "claude-opus-5-5" },
};

describe("resolveSavedModelAlias", () => {
  test("converts an alias to the model ID that it points to", () => {
    expect(
      resolveSavedModelAlias(catalog, { providerId: "claude", modelId: "opus", variant: "max" }),
    ).toEqual({ providerId: "claude", modelId: "claude-opus-5-5", variant: "max" });
  });

  test("prefers an exact model ID to an alias of another model", () => {
    expect(
      resolveSavedModelAlias(catalog, { providerId: "claude", modelId: "claude-opus-5" }),
    ).toEqual({ providerId: "claude", modelId: "claude-opus-5" });
  });

  test("ignores an alias of another provider", () => {
    expect(resolveSavedModelAlias(catalog, { providerId: "other", modelId: "opus" })).toEqual({
      providerId: "other",
      modelId: "opus",
    });
  });
});

describe("coerceVisibleSelectionToCatalog", () => {
  test("keeps the variant of a saved alias", () => {
    expect(
      coerceVisibleSelectionToCatalog(catalog, {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "opus",
        variant: "max",
      }),
    ).toEqual({
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-opus-5-5",
      variant: "max",
    });
  });
});
