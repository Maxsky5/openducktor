import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { resolveModelSelectionOptions } from "./model-selection-options";

const makeSelectedSessionModel = (): AgentModelSelection => ({
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "high",
  profileId: "build-agent",
});

const makeCatalogWithProfile = (): AgentModelCatalog => ({
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
});

describe("model-selection-options", () => {
  test("keeps current-session options when catalog metadata is unavailable", () => {
    const options = resolveModelSelectionOptions({
      selectionCatalog: {
        ...makeCatalogWithProfile(),
        models: [],
        profiles: [],
      },
      selectedModelSelection: makeSelectedSessionModel(),
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
        selectionCatalog: makeCatalogWithProfile(),
        selectedModelSelection: makeSelectedSessionModel(),
      }).agentAccentColorsByProfileId,
    ).toEqual({ "build-agent": "#f59e0b" });
  });

  test("filters active-session variants to live-updatable options", () => {
    const options = resolveModelSelectionOptions({
      liveSession: true,
      selectionCatalog: {
        ...makeCatalogWithProfile(),
        models: [
          {
            id: "anthropic/claude-sonnet",
            providerId: "anthropic",
            providerName: "Anthropic",
            modelId: "claude-sonnet",
            modelName: "Claude Sonnet",
            variants: ["low", "medium", "high", "xhigh", "max"],
            liveSessionUpdates: {
              profile: false,
              variants: ["low", "medium", "high", "xhigh"],
            },
          },
        ],
      },
      selectedModelSelection: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "high",
      },
    });

    expect(options.variantOptions.map((option) => option.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("keeps the current active-session variant visible when it is not live-updatable", () => {
    const options = resolveModelSelectionOptions({
      liveSession: true,
      selectionCatalog: {
        ...makeCatalogWithProfile(),
        models: [
          {
            id: "anthropic/claude-sonnet",
            providerId: "anthropic",
            providerName: "Anthropic",
            modelId: "claude-sonnet",
            modelName: "Claude Sonnet",
            variants: ["low", "medium", "high", "xhigh", "max"],
            liveSessionUpdates: {
              profile: false,
              variants: ["low", "medium", "high", "xhigh"],
            },
          },
        ],
      },
      selectedModelSelection: {
        runtimeKind: "claude",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "max",
      },
    });

    expect(options.variantOptions.map((option) => option.value)).toEqual([
      "max",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });
});
