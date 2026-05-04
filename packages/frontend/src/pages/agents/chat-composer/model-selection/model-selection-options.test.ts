import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { resolveModelSelectionOptions } from "./model-selection-options";

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

describe("model-selection-options", () => {
  test("keeps current-session options when catalog metadata is unavailable", () => {
    const options = resolveModelSelectionOptions({
      selectionCatalog: { ...catalogWithProfile, models: [], profiles: [] },
      selectedModelSelection: selectedSessionModel,
    });

    expect(options.agentProfileOptions).toEqual([
      expect.objectContaining({
        value: "build-agent",
        label: "build-agent",
        description: "Current session agent",
      }),
    ]);
    expect(options.modelOptions).toEqual([
      {
        value: "anthropic/claude-sonnet",
        label: "claude-sonnet",
        description: "anthropic (current session model)",
      },
    ]);
    expect(options.variantOptions).toEqual([{ value: "high", label: "high" }]);
  });

  test("derives catalog-backed agent colors", () => {
    expect(
      resolveModelSelectionOptions({
        selectionCatalog: catalogWithProfile,
        selectedModelSelection: selectedSessionModel,
      }).agentAccentColorsByProfileId,
    ).toEqual({ "build-agent": "#f59e0b" });
  });
});
