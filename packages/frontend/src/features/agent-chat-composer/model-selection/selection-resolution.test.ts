import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { resolveSelectionForNewSession } from "./selection-resolution";

const selectedSessionModel: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "high",
  profileId: "build-agent",
};

const catalogWithProfile: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["default", "high"],
    },
  ],
  defaultModelsByProvider: {},
  profiles: [{ name: "build-agent", mode: "primary", hidden: false, color: "#f59e0b" }],
};

describe("selection-resolution", () => {
  test("resolves new-session selection in draft, default, then catalog order", () => {
    expect(
      resolveSelectionForNewSession({
        draftSelection: null,
        roleDefaultSelectionForComposer: selectedSessionModel,
        selectionCatalog: catalogWithProfile,
        fallbackCatalogSelection: null,
      }),
    ).toBe(selectedSessionModel);
  });
});
