import { CLAUDE_RUNTIME_CAPABILITIES } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "../types/agent-orchestrator";
import { resolveSavedModelAlias } from "./model-catalog-selection";
import { coerceVisibleSelectionToCatalog, isSameSelection } from "./model-selection-state";

const model = (modelId: string): AgentModelCatalog["models"][number] => ({
  id: modelId,
  providerId: "claude",
  providerName: "Claude",
  modelId,
  modelName: modelId,
  variants: ["low", "max"],
});

const catalog: AgentModelCatalog = {
  runtime: {
    kind: "claude",
    label: "Claude",
    description: "Claude model catalog",
    readOnlyRoleBlockedTools: [],
    workflowToolAliasesByCanonical: {},
    capabilities: CLAUDE_RUNTIME_CAPABILITIES,
    capabilityLimits: [],
  },
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

describe("isSameSelection", () => {
  test.each([
    { runtimeKind: "opencode", left: undefined, right: "default", equal: true },
    { runtimeKind: "opencode", left: "default", right: undefined, equal: true },
    { runtimeKind: "opencode", left: "unknown", right: "default", equal: false },
    { runtimeKind: "opencode", left: "high", right: "default", equal: false },
    { runtimeKind: "codex", left: undefined, right: "default", equal: false },
    { runtimeKind: "claude", left: undefined, right: "default", equal: false },
  ] satisfies {
    runtimeKind: RuntimeKind;
    left: string | undefined;
    right: string | undefined;
    equal: boolean;
  }[])(
    "compares $runtimeKind variants $left and $right as $equal",
    ({ runtimeKind, left, right, equal }) => {
      const selection = { runtimeKind, providerId: "provider", modelId: "model" };

      expect(
        isSameSelection({ ...selection, variant: left }, { ...selection, variant: right }),
      ).toBe(equal);
    },
  );
});
