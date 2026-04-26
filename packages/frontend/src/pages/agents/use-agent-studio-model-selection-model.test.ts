import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createSessionMessageOwner } from "@/test-utils/session-message-test-helpers";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  extractLatestContextUsage,
  resolveDraftSelection,
  resolveSessionSelection,
  toModelDescriptorByKey,
  toRoleDefaultSelection,
} from "./use-agent-studio-model-selection-model";

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
        runtimeKind: "opencode",
        providerId: "",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      }),
    ).toBeNull();

    expect(
      toRoleDefaultSelection({
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
      toRoleDefaultSelection(
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
  });

  test("resolves draft selection by normalizing existing selection then falling back", () => {
    expect(
      resolveDraftSelection({
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
      resolveDraftSelection({
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
      resolveDraftSelection({
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

  test("resolves preferred session selection using selected model before defaults", () => {
    expect(
      resolveSessionSelection({
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
      resolveSessionSelection({
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
        session: createSessionMessageOwner(messages),
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 34,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("prefers live session context usage over assistant message history", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 12,
        contextWindow: 10_000,
      }),
    ];

    expect(
      extractLatestContextUsage({
        session: createSessionMessageOwner(messages),
        liveContextUsage: {
          totalTokens: 44,
          contextWindow: 150_000,
          outputLimit: 4_096,
        },
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 44,
      contextWindow: 150_000,
      outputLimit: 4_096,
    });
  });

  test("derives live session context window from stored model identity without scanning messages", () => {
    const lookup = toModelDescriptorByKey(CATALOG);

    expect(
      extractLatestContextUsage({
        session: null,
        liveContextUsage: {
          totalTokens: 44,
          providerId: "openai",
          modelId: "gpt-5",
        },
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 44,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("merges newer live token totals with older assistant-message metadata", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 24,
        contextWindow: 40_000,
        outputLimit: 1_000,
      }),
    ];

    expect(
      extractLatestContextUsage({
        session: createSessionMessageOwner(messages),
        liveContextUsage: {
          totalTokens: 31,
        },
        modelDescriptorByKey: lookup,
      }),
    ).toEqual({
      totalTokens: 31,
      contextWindow: 40_000,
      outputLimit: 1_000,
    });
  });

  test("prefers selected-model fallback metadata before older assistant-message history", () => {
    const lookup = toModelDescriptorByKey(CATALOG);
    const messages: AgentChatMessage[] = [
      createAssistantMessage({
        totalTokens: 24,
        contextWindow: 40_000,
        outputLimit: 1_000,
      }),
    ];

    expect(
      extractLatestContextUsage({
        session: createSessionMessageOwner(messages),
        liveContextUsage: {
          totalTokens: 31,
        },
        modelDescriptorByKey: lookup,
        fallbackContextWindow: 100_000,
        fallbackOutputLimit: 4_096,
      }),
    ).toEqual({
      totalTokens: 31,
      contextWindow: 100_000,
      outputLimit: 4_096,
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
        session: createSessionMessageOwner(messages),
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
        session: createSessionMessageOwner(messages),
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
        session: createSessionMessageOwner(messages),
        modelDescriptorByKey: lookup,
        fallbackContextWindow: 50_000,
      }),
    ).toEqual({
      totalTokens: 55,
      contextWindow: 50_000,
    });
  });
});
