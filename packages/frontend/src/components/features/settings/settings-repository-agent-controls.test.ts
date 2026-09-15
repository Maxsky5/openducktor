import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { buildRepositoryAgentControls } from "./settings-repository-agent-controls";

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
    expect(controls.profile.placeholder).toBe("Runtime does not support agent profiles");
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
    expect(controls.variant.placeholder).toBe("No variants for model");
  });

  test("hides the variant control when the runtime has no variant support", () => {
    const controls = buildRepositoryAgentControls({
      value: savedDefault,
      runtimeKind: "opencode",
      runtimeDescriptor: descriptorWithoutVariants,
      catalog: opencodeCatalog,
      isCatalogLoading: false,
      isSaving: false,
    });

    expect(controls.variant.visible).toBeFalse();
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
});
