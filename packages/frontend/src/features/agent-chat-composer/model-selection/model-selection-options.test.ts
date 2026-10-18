import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { findRunningTurnModelEntry, resolveModelSelectionOptions } from "./model-selection-options";

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
        description: "Current session profile",
      }),
    ]);
    expect(options.variantOptions).toEqual([{ value: "high", label: "high" }]);
  });

  test("does not use native profile colors in picker options", () => {
    const options = resolveModelSelectionOptions({
      selectionCatalog: makeCatalogWithProfile(),
      selectedModelSelection: makeSelectedSessionModel(),
    });
    expect(options.agentProfileOptions).toEqual([{ value: "build-agent", label: "build-agent" }]);
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

  test.each(
    [["low", "medium", "high", "xhigh", "max"], ["low", "medium", "high", "xhigh"], []].map(
      (variants) => ({ variants }),
    ),
  )(
    "keeps accepted effort visible when the catalog omits it or disallows live changes: $variants",
    ({ variants }) => {
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
              variants,
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

      expect(options.variantOptions[0]).toMatchObject({
        value: "max",
        label: "max",
        disabled: true,
      });
    },
  );

  test("keeps an accepted profile visible when a later catalog lists other profiles", () => {
    const options = resolveModelSelectionOptions({
      liveSession: true,
      selectionCatalog: {
        ...makeCatalogWithProfile(),
        profiles: [{ name: "other", mode: "primary" }],
      },
      selectedModelSelection: makeSelectedSessionModel(),
    });
    expect(options.agentProfileOptions).toContainEqual(
      expect.objectContaining({
        value: "build-agent",
        label: "build-agent",
        disabled: true,
      }),
    );
  });
});

describe("findRunningTurnModelEntry", () => {
  const catalog = makeCatalogWithProfile();
  const userMessage = (id: string, modelId?: string): AgentChatMessage => {
    const meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }> = {
      kind: "user",
      state: "read",
    };
    if (modelId) {
      meta.providerId = "anthropic";
      meta.modelId = modelId;
    }
    return { id, role: "user", content: id, timestamp: "2026-10-09T10:00:00.000Z", meta };
  };

  test("uses the latest user message that reports a model", () => {
    const answer: AgentChatMessage = {
      id: "answer",
      role: "assistant",
      content: "answer",
      timestamp: "2026-10-09T10:00:01.000Z",
    };
    const messages = [
      userMessage("started", "claude-sonnet"),
      answer,
      userMessage("steered without a model"),
    ];

    expect(findRunningTurnModelEntry(catalog, messages)?.id).toBe("anthropic/claude-sonnet");
  });

  test("returns null when the model of the running turn is unknown", () => {
    expect(findRunningTurnModelEntry(catalog, [userMessage("no model")])).toBeNull();
    expect(findRunningTurnModelEntry(catalog, [userMessage("other", "claude-opus")])).toBeNull();
    expect(findRunningTurnModelEntry(null, [userMessage("started", "claude-sonnet")])).toBeNull();
  });
});
