import { describe, expect, test } from "bun:test";
import {
  ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RuntimeModelCatalogQueryResource } from "../../queries/use-runtime-model-catalogs";
import { resolveRecommendedDefaultModel } from "./recommended-default-model";

const makeResource = (
  descriptor: RuntimeDescriptor,
  catalog: AgentModelCatalog | null,
  overrides: Partial<RuntimeModelCatalogQueryResource> = {},
): RuntimeModelCatalogQueryResource => ({
  runtimeKind: descriptor.kind,
  catalog,
  isLoading: false,
  unavailableReason: null,
  isEnabled: true,
  error: null,
  retry: async () => {},
  ...overrides,
});

const claudeCatalog: AgentModelCatalog = {
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "claude-sonnet-4-6",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-sonnet-4-6",
      modelName: "Claude Sonnet 4.6",
      variants: ["low", "medium", "high"],
    },
    {
      id: "claude-opus-4-8",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-opus-4-8",
      modelName: "Opus 4.8",
      variants: ["low", "medium", "high", "max"],
    },
    {
      id: "claude-opus-5-5",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-opus-5-5",
      modelName: "Opus 5.5",
      aliases: ["opus"],
      variants: ["low", "medium", "high", "xhigh", "max"],
    },
  ],
  defaultModelsByProvider: { claude: "claude-sonnet-4-6" },
};

const codexCatalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "gpt-5.6-sol",
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-5.6-sol",
      modelName: "GPT-5.6-Sol",
      variants: ["low", "medium", "high"],
    },
    {
      id: "gpt-6.1-sol-mini",
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-6.1-sol-mini",
      modelName: "GPT-6.1-Sol Mini",
      variants: ["low", "medium", "high"],
    },
    {
      id: "gpt-6.1-sol",
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-6.1-sol",
      modelName: "GPT-6.1-Sol",
      variants: ["low", "medium", "high", "xhigh"],
    },
  ],
  defaultModelsByProvider: { codex: "gpt-6.1-sol" },
};

const antigravityCatalogWithNeon: AgentModelCatalog = {
  runtime: ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "antigravity/gemini-3.8-flash",
      providerId: "antigravity",
      providerName: "Antigravity",
      modelId: "gemini-3.8-flash",
      modelName: "Gemini 3.8 Flash",
      variants: ["low", "medium", "high"],
    },
    {
      id: "antigravity/gemini-neon",
      providerId: "antigravity",
      providerName: "Antigravity",
      modelId: "gemini-neon",
      modelName: "Gemini Neon",
      variants: ["low", "medium", "high"],
    },
  ],
  defaultModelsByProvider: {},
};

const antigravityCatalogFlashOnly: AgentModelCatalog = {
  runtime: ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "antigravity/gemini-3.0-flash",
      providerId: "antigravity",
      providerName: "Antigravity",
      modelId: "gemini-3.0-flash",
      modelName: "Gemini 3.0 Flash",
      variants: ["low", "medium", "high"],
    },
    {
      id: "antigravity/gemini-3.8-flash-lite",
      providerId: "antigravity",
      providerName: "Antigravity",
      modelId: "gemini-3.8-flash-lite",
      modelName: "Gemini 3.8 Flash Lite",
      variants: ["low", "medium", "high"],
    },
    {
      id: "antigravity/gemini-3.8-flash",
      providerId: "antigravity",
      providerName: "Antigravity",
      modelId: "gemini-3.8-flash",
      modelName: "Gemini 3.8 Flash",
      variants: ["low", "medium", "high"],
    },
  ],
  defaultModelsByProvider: {},
};

describe("resolveRecommendedDefaultModel", () => {
  test("prefers latest Claude Opus in high effort when Claude is enabled alongside Codex and Antigravity", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [
        OPENCODE_RUNTIME_DESCRIPTOR,
        CODEX_RUNTIME_DESCRIPTOR,
        CLAUDE_RUNTIME_DESCRIPTOR,
        ANTIGRAVITY_RUNTIME_DESCRIPTOR,
      ],
      catalogResources: [
        makeResource(CODEX_RUNTIME_DESCRIPTOR, codexCatalog),
        makeResource(CLAUDE_RUNTIME_DESCRIPTOR, claudeCatalog),
        makeResource(ANTIGRAVITY_RUNTIME_DESCRIPTOR, antigravityCatalogWithNeon),
      ],
    });

    expect(result).toEqual({
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "claude-opus-5-5",
      variant: "high",
      profileId: "",
    });
  });

  test("ignores trailing release dates when comparing Claude Opus versions", () => {
    const datedClaudeCatalog: AgentModelCatalog = {
      runtime: CLAUDE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "claude-opus-4-20250514",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-opus-4-20250514",
          modelName: "Claude Opus 4",
          variants: ["high"],
        },
        {
          id: "claude-opus-4-5-20251101",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-opus-4-5-20251101",
          modelName: "Claude Opus 4.5",
          variants: ["high"],
        },
        {
          id: "claude-opus-4-6",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-opus-4-6",
          modelName: "Claude Opus 4.6",
          variants: ["low", "high"],
        },
      ],
      defaultModelsByProvider: {},
    };

    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [CLAUDE_RUNTIME_DESCRIPTOR],
      catalogResources: [makeResource(CLAUDE_RUNTIME_DESCRIPTOR, datedClaudeCatalog)],
    });

    expect(result?.modelId).toBe("claude-opus-4-6");
    expect(result?.variant).toBe("high");
  });

  test("falls back to latest Codex GPT X Sol in high effort when Claude is unavailable or disabled", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [
        CLAUDE_RUNTIME_DESCRIPTOR,
        CODEX_RUNTIME_DESCRIPTOR,
        ANTIGRAVITY_RUNTIME_DESCRIPTOR,
      ],
      catalogResources: [
        makeResource(CLAUDE_RUNTIME_DESCRIPTOR, claudeCatalog, { isEnabled: false }),
        makeResource(CODEX_RUNTIME_DESCRIPTOR, codexCatalog),
        makeResource(ANTIGRAVITY_RUNTIME_DESCRIPTOR, antigravityCatalogWithNeon),
      ],
    });

    expect(result).toEqual({
      runtimeKind: "codex",
      providerId: "codex",
      modelId: "gpt-6.1-sol",
      variant: "high",
      profileId: "",
    });
  });

  test("picks Antigravity Gemini Neon in high effort when neither Claude nor Codex is enabled", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [ANTIGRAVITY_RUNTIME_DESCRIPTOR],
      catalogResources: [makeResource(ANTIGRAVITY_RUNTIME_DESCRIPTOR, antigravityCatalogWithNeon)],
    });

    expect(result).toEqual({
      runtimeKind: "antigravity",
      providerId: "antigravity",
      modelId: "gemini-neon",
      variant: "high",
      profileId: "",
    });
  });

  test("falls back to latest Antigravity Gemini Flash in high effort when Gemini Neon is absent", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [ANTIGRAVITY_RUNTIME_DESCRIPTOR],
      catalogResources: [makeResource(ANTIGRAVITY_RUNTIME_DESCRIPTOR, antigravityCatalogFlashOnly)],
    });

    expect(result).toEqual({
      runtimeKind: "antigravity",
      providerId: "antigravity",
      modelId: "gemini-3.8-flash",
      variant: "high",
      profileId: "",
    });
  });

  test("waits while a higher-priority enabled runtime is still loading its catalog", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [CLAUDE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      catalogResources: [
        makeResource(CLAUDE_RUNTIME_DESCRIPTOR, null, { isLoading: true }),
        makeResource(CODEX_RUNTIME_DESCRIPTOR, codexCatalog),
      ],
    });

    expect(result).toBeNull();
  });

  test("returns null when no enabled runtime exposes a matching recommended model", () => {
    const result = resolveRecommendedDefaultModel({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      catalogResources: [
        makeResource(OPENCODE_RUNTIME_DESCRIPTOR, {
          runtime: OPENCODE_RUNTIME_DESCRIPTOR,
          models: [
            {
              id: "anthropic/claude-opus-5-5",
              providerId: "anthropic",
              providerName: "Anthropic",
              modelId: "claude-opus-5-5",
              modelName: "Claude Opus 5.5",
              variants: ["high"],
            },
          ],
          defaultModelsByProvider: {},
        }),
      ],
    });

    expect(result).toBeNull();
  });
});
