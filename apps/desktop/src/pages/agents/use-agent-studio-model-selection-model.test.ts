import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  extractLatestContextUsage,
  resolveDraftSelection,
  resolveSessionSelection,
  toModelDescriptorByKey,
  toRoleDefaultSelection,
} from "./use-agent-studio-model-selection-model";

const CATALOG: AgentModelCatalog = {
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
  agents: [
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

let messageCounter = 0;

const createAssistantMessage = (
  overrides: Partial<Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>> = {},
): AgentChatMessage => {
  messageCounter += 1;
  return {
    id: `message-${messageCounter}`,
    role: "assistant",
    content: "",
    timestamp: "2026-02-20T10:00:00.000Z",
    meta: {
      kind: "assistant",
      agentRole: "spec",
      ...overrides,
    },
  };
};

describe("use-agent-studio-model-selection-model", () => {
  test("maps repo role defaults to model selection shape", () => {
    expect(toRoleDefaultSelection(null)).toBeNull();
    expect(
      toRoleDefaultSelection({
        providerId: "",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "spec-agent",
      }),
    ).toBeNull();

    expect(
      toRoleDefaultSelection({
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "spec-agent",
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });
  });

  test("resolves draft selection by normalizing existing selection then falling back", () => {
    expect(
      resolveDraftSelection({
        catalog: CATALOG,
        existingSelection: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "missing-variant",
          opencodeAgent: "hidden-subagent",
        },
        roleDefaultSelection: null,
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      resolveDraftSelection({
        catalog: CATALOG,
        existingSelection: null,
        roleDefaultSelection: {
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      resolveDraftSelection({
        catalog: CATALOG,
        existingSelection: null,
        roleDefaultSelection: null,
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec-agent",
    });
  });

  test("resolves preferred session selection using selected model before defaults", () => {
    expect(
      resolveSessionSelection({
        catalog: CATALOG,
        selectedModel: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "spec-agent",
        },
        roleDefaultSelection: {
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    expect(
      resolveSessionSelection({
        catalog: CATALOG,
        selectedModel: {
          providerId: "missing",
          modelId: "model",
        },
        roleDefaultSelection: null,
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec-agent",
    });
  });

  test("indexes model descriptors by provider and model id", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    expect(lookup.get("openai::gpt-5")?.id).toBe("openai/gpt-5");
    expect(lookup.get("anthropic::claude-sonnet")?.id).toBe("anthropic/claude-sonnet");
    expect(toModelDescriptorByKey(null).size).toBe(0);
  });

  test("extracts latest assistant context usage with descriptor fallback", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 12,
        contextWindow: 10_000,
        outputLimit: 500,
      }),
      createAssistantMessage({
        totalTokens: 34,
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ];

    expect(
      extractLatestContextUsage({
        messages,
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 34,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("falls back to an older assistant message when the latest tokenized one has no usable context window", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 12,
        contextWindow: 10_000,
      }),
      createAssistantMessage({
        totalTokens: 34,
      }),
    ];

    expect(
      extractLatestContextUsage({
        messages,
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 12,
      contextWindow: 10_000,
    });
  });

  test("returns null when no assistant message has a usable context window", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 34,
      }),
    ];

    expect(
      extractLatestContextUsage({
        messages,
        modelDescriptorByKey: lookup,
      }),
    ).toBeNull();
  });

  test("uses selected model context window as final fallback", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 55,
      }),
    ];

    expect(
      extractLatestContextUsage({
        messages,
        modelDescriptorByKey: lookup,
        fallbackContextWindow: 50_000,
      }),
    ).toEqual({
      totalTokens: 55,
      contextWindow: 50_000,
    });
  });
});
