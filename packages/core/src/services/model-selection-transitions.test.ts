import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "../types/agent-orchestrator";
import {
  resolveInitialModelSelection,
  resolveModelSelectionForModelChange,
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForRuntimeChange,
  resolveModelSelectionForVariantChange,
  resolvePreferredModelSelection,
} from "./model-selection-state";

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["standard"],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [
    { id: "reviewer", name: "Reviewer", mode: "primary", hidden: false },
    { id: "hidden-helper", name: "Hidden helper", mode: "subagent", hidden: true },
  ],
};

const EXPLICIT_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "standard",
  profileId: "reviewer",
};

describe("model-selection-state", () => {
  test("starts from an explicit caller selection without a workflow role", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: EXPLICIT_SELECTION,
      }),
    ).toEqual(EXPLICIT_SELECTION);

    const { runtimeKind: _runtimeKind, ...selectionWithoutRuntime } = EXPLICIT_SELECTION;
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: selectionWithoutRuntime,
      }),
    ).toEqual(EXPLICIT_SELECTION);
  });

  test("supports no caller default and still requires an explicit runtime", () => {
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: null,
        selectedModel: null,
      }),
    ).toBeNull();
    expect(
      resolveInitialModelSelection({
        catalog: CATALOG,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "reviewer",
    });
    expect(
      resolveInitialModelSelection({
        catalog: null,
        defaultSelection: null,
        runtimeKind: "opencode",
        selectedModel: null,
      }),
    ).toBeNull();
  });

  test("changes runtime from caller-owned inputs without a workflow role", () => {
    expect(
      resolveModelSelectionForRuntimeChange({
        catalog: null,
        currentSelection: EXPLICIT_SELECTION,
        defaultSelection: {
          runtimeKind: "claude",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
        selectedModel: null,
        runtimeKind: "claude",
      }),
    ).toEqual({
      runtimeKind: "claude",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(
      resolveModelSelectionForRuntimeChange({
        catalog: null,
        currentSelection: EXPLICIT_SELECTION,
        defaultSelection: null,
        selectedModel: null,
        runtimeKind: "claude",
      }),
    ).toBeNull();
  });

  test("rejects a runtime-change default that is absent from the target catalog", () => {
    expect(
      resolveModelSelectionForRuntimeChange({
        catalog: CATALOG,
        currentSelection: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "default",
        },
        defaultSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "retired-model",
        },
        selectedModel: null,
        runtimeKind: "opencode",
      }),
    ).toBeNull();
  });

  test("changes model and normalizes the variant while preserving the runtime profile", () => {
    expect(
      resolveModelSelectionForModelChange({
        catalog: CATALOG,
        currentSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "reviewer",
        },
        modelKey: "anthropic/claude-sonnet",
        runtimeKind: "opencode",
        preferredVariant: "high",
        preferredSpeed: undefined,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "standard",
      profileId: "reviewer",
    });

    expect(
      resolveModelSelectionForModelChange({
        catalog: {
          ...CATALOG,
          models: [
            {
              id: "runtime-model-o3",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "o3",
              modelName: "o3",
              variants: ["low", "high"],
            },
          ],
        },
        currentSelection: null,
        modelKey: "openai/o3",
        runtimeKind: "opencode",
        preferredVariant: undefined,
        preferredSpeed: undefined,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "o3",
      variant: "low",
      profileId: "reviewer",
    });
  });

  test("keeps the effort when the new model supports it", () => {
    const catalog: AgentModelCatalog = {
      ...CATALOG,
      models: [...CATALOG.models, { ...CATALOG.models[0]!, id: "openai/o3", modelId: "o3" }],
    };

    expect(
      resolveModelSelectionForPair({
        catalog,
        currentCatalog: catalog,
        currentSelection: {
          ...EXPLICIT_SELECTION,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
        defaultSelection: null,
        selectedModel: null,
        value: { runtimeKind: "opencode", providerId: "openai", modelId: "o3" },
      })?.selection.variant,
    ).toBe("high");
  });

  test.each([
    // Claude calls the "Fast" level `fast`, and Codex calls it `priority`.
    {
      source: { variant: "high", speed: "fast" },
      expected: { variant: "high", speed: "priority" },
    },
    { source: { variant: "max", speed: "turbo" }, expected: { variant: "low" } },
    // The runtime default ("medium" and "flex") must not replace a missing effort or speed.
    { source: {}, expected: { variant: "low" } },
  ])(
    "keeps the supported effort and speed of $source when the runtime changes",
    ({ source, expected }) => {
      const claudeCatalog: AgentModelCatalog = {
        runtime: CLAUDE_RUNTIME_DESCRIPTOR,
        models: [
          {
            id: "claude/claude-opus",
            providerId: "claude",
            providerName: "Claude",
            modelId: "claude-opus",
            modelName: "Claude Opus",
            variants: ["low", "high", "max"],
            speedLevels: [
              { id: "fast", label: "Fast" },
              { id: "turbo", label: "Turbo" },
            ],
          },
        ],
        defaultModelsByProvider: { claude: "claude-opus" },
      };
      const codexCatalog: AgentModelCatalog = {
        runtime: CODEX_RUNTIME_DESCRIPTOR,
        models: [
          {
            id: "openai/gpt-5.5",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5.5",
            modelName: "GPT-5.5",
            variants: ["low", "medium", "high"],
            speedLevels: [
              { id: "priority", label: "Fast" },
              { id: "flex", label: "Flex" },
            ],
          },
        ],
        defaultModelsByProvider: { openai: "gpt-5.5" },
      };

      expect(
        resolveModelSelectionForPair({
          catalog: codexCatalog,
          currentCatalog: claudeCatalog,
          currentSelection: {
            runtimeKind: "claude",
            providerId: "claude",
            modelId: "claude-opus",
            ...source,
          },
          defaultSelection: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5.5",
            variant: "medium",
            speed: "flex",
          },
          selectedModel: null,
          value: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5.5" },
        })?.selection,
      ).toEqual({ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5.5", ...expected });
    },
  );

  test("keeps a speed only on models that support it", () => {
    const catalog: AgentModelCatalog = {
      ...CATALOG,
      models: [
        { ...CATALOG.models[0]!, speedLevels: [{ id: "fast", label: "Fast" }] },
        ...CATALOG.models.slice(1),
      ],
    };
    const fast = { ...EXPLICIT_SELECTION, providerId: "openai", modelId: "gpt-5", speed: "fast" };

    expect(
      resolvePreferredModelSelection({
        catalog,
        preferredSelection: fast,
        fallbackSelection: null,
      })?.speed,
    ).toBe("fast");
    for (const modelKey of ["anthropic/claude-sonnet", "openai/gpt-5"]) {
      expect(
        resolveModelSelectionForModelChange({
          catalog,
          currentSelection: fast,
          modelKey,
          runtimeKind: "opencode",
          preferredVariant: fast.variant,
          preferredSpeed: { id: fast.speed },
        })?.speed,
      ).toBe(modelKey === "openai/gpt-5" ? "fast" : undefined);
    }
  });

  test("normalizes an invalid variant against the selected catalog model", () => {
    expect(
      resolveModelSelectionForVariantChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        variant: "removed",
      }),
    ).toEqual(EXPLICIT_SELECTION);
  });

  test("selects visible runtime profiles and rejects hidden profiles", () => {
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        profileId: "reviewer",
        runtimeKind: "opencode",
      }),
    ).toEqual(EXPLICIT_SELECTION);
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: EXPLICIT_SELECTION,
        profileId: "hidden-helper",
        runtimeKind: "opencode",
      }),
    ).toEqual(EXPLICIT_SELECTION);
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: { ...EXPLICIT_SELECTION, runtimeKind: "claude" },
        profileId: "reviewer",
        runtimeKind: "opencode",
      }),
    ).toBeNull();
  });

  test("does not invent a catalog default when no model is selected", () => {
    expect(
      resolveModelSelectionForProfileChange({
        catalog: CATALOG,
        currentSelection: null,
        profileId: "reviewer",
        runtimeKind: "opencode",
      }),
    ).toBeNull();
  });

  test("normalizes a draft against a reloaded catalog and removes missing selected values", () => {
    const staleSelection: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "removed",
      profileId: "removed-profile",
    };
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: staleSelection,
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });
  });
});
