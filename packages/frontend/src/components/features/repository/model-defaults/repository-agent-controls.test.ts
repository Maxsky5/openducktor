import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { applyRepoAgentDefaultField } from "./model-defaults-model";
import { buildRepositoryAgentControls } from "./repository-agent-controls";
import { didResetDefaultSpeed, selectPickedModel } from "./repository-agent-selection";

const savedDefault = {
  runtimeKind: "opencode",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  variant: "high",
  profileId: "build",
} as const;

const opencodeCatalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["low", "high"],
    },
    {
      id: "anthropic/claude-haiku",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-haiku",
      modelName: "Claude Haiku",
      variants: [],
    },
  ],
  defaultModelsByProvider: { anthropic: "claude-sonnet" },
  profiles: [{ id: "build", label: "build", mode: "primary" }],
};

const descriptorWithoutVariants: RuntimeDescriptor = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    optionalSurfaces: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
      supportsVariants: false,
    },
  },
};

describe("buildRepositoryAgentControls", () => {
  test("shows the model and effort options that a saved alias points to", () => {
    const controls = buildRepositoryAgentControls({
      value: { ...savedDefault, modelId: "sonnet" },
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: {
        ...opencodeCatalog,
        models: opencodeCatalog.models.map((model) =>
          model.modelId === "claude-sonnet" ? { ...model, aliases: ["sonnet"] } : model,
        ),
      },
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.selectedPickerValue?.modelId).toBe("claude-sonnet");
    expect(controls.variant.options.map((option) => option.value)).toEqual(["low", "high"]);
  });

  test("enables the profile control when the runtime supports profiles", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.selectedPickerValue).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(controls.profile.disabled).toBeFalse();
    expect(controls.profile.placeholder).toBe("Select agent");
    expect(controls.profile.options.map((option) => option.value)).toEqual(["build"]);
  });

  test("disables the profile control with a reason when the runtime has no profile support", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "codex",
      runtimeDescriptor: CODEX_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.profile.disabled).toBeTrue();
    expect(controls.profile.placeholder).toBe("Not supported by runtime");
  });

  test("disables the profile control while the catalog loads", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: null,
      isCatalogLoading: true,
      isSaving: false,
    });

    expect(controls.profile.disabled).toBeTrue();
    expect(controls.profile.placeholder).toBe("Loading agents…");
  });

  test("disables the variant control when the model has no variants", () => {
    const controls = buildRepositoryAgentControls({
      value: { ...savedDefault, modelId: "claude-haiku" },
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.variant.options).toEqual([]);
    expect(controls.variant.disabled).toBeTrue();
    expect(controls.variant.placeholder).toBe("No effort options");
  });

  test("disables effort when the runtime handles it", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "opencode",
      runtimeDescriptor: descriptorWithoutVariants,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.variant.disabled).toBeTrue();
    expect(controls.variant.options).toEqual([]);
    expect(controls.variant.placeholder).toBe("Runtime sets effort");
  });

  test("disables the profile and variant controls while settings save", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: true,
    });

    expect(controls.profile.disabled).toBeTrue();
    expect(controls.variant.disabled).toBeTrue();
  });

  test("disables the variant control until the saved default has a model", () => {
    const controls = buildRepositoryAgentControls({
      value: { ...savedDefault, providerId: "", modelId: "" },
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.selectedPickerValue).toBeNull();
    expect(controls.variant.disabled).toBeTrue();
  });

  test("disables the profile control until the saved default has a model", () => {
    const controls = buildRepositoryAgentControls({
      value: { ...savedDefault, providerId: "", modelId: "" },
      runtimeKind: "opencode",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.selectedPickerValue).toBeNull();
    expect(controls.profile.options.map((option) => option.value)).toEqual(["build"]);
    expect(controls.profile.disabled).toBeTrue();
    expect(controls.profile.placeholder).toBe("Select a model first");
  });

  test("builds speed controls only for speed-capable runtimes when enabled", () => {
    const codexCatalog: AgentModelCatalog = {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT-5",
          variants: ["high"],
          speedLevels: [{ id: "priority", label: "Fast" }],
        },
      ],
      defaultModelsByProvider: { openai: "gpt-5" },
      speedAvailability: {
        status: "blocked",
        reason: { code: "plan_required", message: "Fast mode requires an active plan." },
      },
    };

    const enabled = buildRepositoryAgentControls({
      value: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "",
        speed: "priority",
      },
      runtimeKind: "codex",
      runtimeDescriptor: CODEX_RUNTIME_DESCRIPTOR,
      catalog: codexCatalog,
      isCatalogLoading: false,
      isSaving: false,
      includeSpeed: true,
      onSelectSpeed: () => {},
    });
    expect(enabled.speed?.choice).toBe("priority");
    expect(enabled.speed?.levels).toEqual([{ id: "priority", label: "Fast" }]);
    expect(enabled.speed?.blockedReason).toBe("Fast mode requires an active plan.");

    const disabledForNaming = buildRepositoryAgentControls({
      value: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "",
      },
      runtimeKind: "codex",
      runtimeDescriptor: CODEX_RUNTIME_DESCRIPTOR,
      catalog: codexCatalog,
      isCatalogLoading: false,
      isSaving: false,
      includeSpeed: false,
    });
    expect(disabledForNaming.speed).toBeNull();
  });

  test("maps speed across runtimes, clears unsupported speed, and omits standard", () => {
    const claudeCatalog: AgentModelCatalog = {
      runtime: CLAUDE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "claude/claude-opus-4-6",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-opus-4-6",
          modelName: "Claude Opus 4.6",
          variants: ["high"],
          speedLevels: [{ id: "fast", label: "Fast" }],
        },
      ],
      defaultModelsByProvider: {},
    };
    const codexCatalog: AgentModelCatalog = {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT-5",
          variants: ["high"],
          speedLevels: [{ id: "priority", label: "Fast" }],
        },
      ],
      defaultModelsByProvider: {},
    };

    const current = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-opus-4-6",
      variant: "high",
      profileId: "",
      speed: "fast",
    };

    const mapped = selectPickedModel(
      current,
      { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
      codexCatalog,
      { currentCatalog: claudeCatalog, includeSpeed: true },
    );
    expect(mapped?.speed).toBe("priority");
    expect(didResetDefaultSpeed(current, mapped)).toBe(false);

    const dropped = selectPickedModel(
      current,
      { runtimeKind: "opencode", providerId: "anthropic", modelId: "claude-sonnet" },
      opencodeCatalog,
      { currentCatalog: claudeCatalog, includeSpeed: true },
    );
    expect(dropped?.speed).toBeUndefined();
    expect(didResetDefaultSpeed(current, dropped)).toBe(true);

    const resetToStandard = applyRepoAgentDefaultField(current, "speed", "standard");
    expect(resetToStandard.speed).toBeUndefined();
    expect("speed" in resetToStandard).toBe(false);
  });
});
