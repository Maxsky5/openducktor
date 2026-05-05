import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  resolveActiveSessionModelSelection,
  resolveDraftModelSelection,
  toRoleDefaultModelSelection,
} from "./model-selection-preferences";

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
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: [],
      contextWindow: 100_000,
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    {
      name: "spec-agent",
      mode: "primary",
      hidden: false,
      color: "#f59e0b",
    },
    {
      name: "hidden-subagent",
      mode: "subagent",
      hidden: true,
    },
  ],
};

describe("model-selection-preferences", () => {
  test("maps repo role defaults to model selection shape", () => {
    expect(toRoleDefaultModelSelection(null)).toBeNull();
    expect(
      toRoleDefaultModelSelection({
        runtimeKind: "opencode",
        providerId: "",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      }),
    ).toBeNull();

    expect(
      toRoleDefaultModelSelection({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    expect(
      toRoleDefaultModelSelection(
        {
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "",
          profileId: "",
        },
        "opencode",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      toRoleDefaultModelSelection(
        {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "",
          profileId: "",
        },
        "opencode",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
  });

  test("resolves draft selection by normalizing existing selection then falling back", () => {
    expect(
      resolveDraftModelSelection({
        catalog: CATALOG,
        existingSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "missing-variant",
          profileId: "hidden-subagent",
        },
        roleDefaultSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      resolveDraftModelSelection({
        catalog: CATALOG,
        existingSelection: null,
        roleDefaultSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      resolveDraftModelSelection({
        catalog: CATALOG,
        existingSelection: null,
        roleDefaultSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolves preferred active-session model using selected model before defaults", () => {
    expect(
      resolveActiveSessionModelSelection({
        catalog: CATALOG,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        },
        roleDefaultSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    expect(
      resolveActiveSessionModelSelection({
        catalog: CATALOG,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "missing",
          modelId: "model",
        },
        roleDefaultSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });
});
