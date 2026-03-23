import { describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";

enableReactActEnvironment();

let messageCounter = 0;

type HookArgs = Parameters<typeof useAgentStudioModelSelection>[0];

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
      name: "build-agent",
      mode: "primary",
      hidden: false,
    },
  ],
};

const ALTERNATE_CATALOG: AgentModelCatalog = {
  models: [
    {
      id: "anthropic/claude-opus",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-opus",
      modelName: "Claude Opus",
      variants: ["extended"],
      contextWindow: 300_000,
    },
  ],
  defaultModelsByProvider: {
    anthropic: "claude-opus",
  },
  profiles: [
    {
      name: "planner-agent",
      mode: "primary",
      hidden: false,
      color: "#0ea5e9",
    },
  ],
};

const CATALOG_WITHOUT_PROFILES: AgentModelCatalog = {
  ...CATALOG,
  profiles: [],
};

const createRepoSettings = (
  specDefault: RepoSettingsInput["agentDefaults"]["spec"] | null,
): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: specDefault,
    planner: null,
    build: null,
    qa: null,
  },
});

const createActiveSession = (overrides = {}) =>
  createAgentSessionFixture({
    modelCatalog: CATALOG,
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    },
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioModelSelection, initialProps);

const createAssistantMessage = (
  overrides: Partial<Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>> = {},
): AgentChatMessage => {
  messageCounter += 1;
  return {
    id: `assistant-message-${messageCounter}`,
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

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  activeSession: null,
  role: "spec",
  repoSettings: null,
  updateAgentSessionModel: () => {},
  loadCatalog: async () => CATALOG,
  ...overrides,
});

describe("useAgentStudioModelSelection", () => {
  test("uses repo role defaults when available", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("keeps repo defaults selectable when composer catalog is unavailable", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build-agent",
      });
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("preserves selected agent profile when catalog does not expose profile metadata", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        }),
        loadCatalog: async () => CATALOG_WITHOUT_PROFILES,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

    expect(harness.getLatest().selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("publishes agent colors from composer catalog before a session is started", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.agentOptions.length > 0);

    const state = harness.getLatest();
    expect(state.activeSessionAgentColors).toMatchObject({
      "spec-agent": "#f59e0b",
    });

    await harness.unmount();
  });

  test("updates draft selections through model and variant handlers", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-sonnet");

    await harness.run(() => {
      harness.getLatest().handleSelectModel("openai/gpt-5");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectVariant("high");
    });
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    await harness.run(() => {
      harness.getLatest().handleSelectAgent("build-agent");
    });

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("routes selection updates to active sessions via callback", async () => {
    const updateAgentSessionModel = mock(() => {});
    const activeSession = createActiveSession();

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        updateAgentSessionModel,
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.modelId === "gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectVariant("high");
    });

    expect(updateAgentSessionModel).toHaveBeenCalledWith("session-1", {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("does not load the repo composer catalog while an active session owns runtime catalog loading", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const activeSession = createActiveSession({
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog,
      }),
    );

    try {
      await harness.mount();

      expect(loadCatalog).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps loading while no catalog source is available for an active session", async () => {
    const activeSession = createActiveSession({
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog: async () => CATALOG,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("invalidates composer catalog and ignores stale repo loads when active repo changes", async () => {
    const repoALoad = createDeferred<AgentModelCatalog>();
    const repoBLoad = createDeferred<AgentModelCatalog>();
    const loadCatalog = mock(
      (repoPath: string, _runtimeKind: string): Promise<AgentModelCatalog> => {
        if (repoPath === "/repo-a") {
          return repoALoad.promise;
        }
        if (repoPath === "/repo-b") {
          return repoBLoad.promise;
        }
        return Promise.reject(new Error(`Unexpected repo path: ${repoPath}`));
      },
    );

    const harness = createHookHarness(
      createBaseProps({
        activeRepo: "/repo-a",
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);

      await harness.update(
        createBaseProps({
          activeRepo: "/repo-b",
          loadCatalog,
        }),
      );

      expect(loadCatalog).toHaveBeenCalledTimes(2);
      expect(loadCatalog.mock.calls[0]).toEqual(["/repo-a", "opencode"]);
      expect(loadCatalog.mock.calls[1]).toEqual(["/repo-b", "opencode"]);

      await harness.run(async () => {
        repoALoad.resolve(CATALOG);
        await repoALoad.promise;
      });

      expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);
      expect(harness.getLatest().selectedModelSelection).toBeNull();

      await harness.run(async () => {
        repoBLoad.resolve(ALTERNATE_CATALOG);
        await repoBLoad.promise;
      });
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "claude-opus",
      );

      const state = harness.getLatest();
      expect(state.selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      repoALoad.resolve(CATALOG);
      repoBLoad.resolve(ALTERNATE_CATALOG);
      await harness.unmount();
    }
  });

  test("uses defaults from the newly selected repository after switching repos", async () => {
    const loadCatalog = mock(
      async (repoPath: string, _runtimeKind: string): Promise<AgentModelCatalog> => {
        if (repoPath === "/repo-a") {
          return CATALOG;
        }
        if (repoPath === "/repo-b") {
          return ALTERNATE_CATALOG;
        }
        throw new Error(`Unexpected repo path: ${repoPath}`);
      },
    );

    const harness = createHookHarness(
      createBaseProps({
        activeRepo: "/repo-a",
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "gpt-5" &&
          state.selectedModelSelection.variant === "high",
      );

      await harness.run(() => {
        harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
      });
      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-sonnet");

      await harness.update(
        createBaseProps({
          activeRepo: "/repo-b",
          repoSettings: createRepoSettings({
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-opus",
            variant: "extended",
            profileId: "planner-agent",
          }),
          loadCatalog,
        }),
      );

      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-opus");

      expect(harness.getLatest().selectedModelSelection).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not reuse stale repo defaults while waiting for the next repo settings", async () => {
    const harness = createHookHarness(
      createBaseProps({
        activeRepo: "/repo-a",
        repoSettings: createRepoSettings({
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        loadCatalog: async () => {
          throw new Error("catalog unavailable");
        },
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection?.modelId === "gpt-5",
      );

      await harness.update(
        createBaseProps({
          activeRepo: "/repo-b",
          repoSettings: null,
          loadCatalog: async () => {
            throw new Error("catalog unavailable");
          },
        }),
      );

      await harness.waitFor(
        (state) =>
          state.isSelectionCatalogLoading === false &&
          state.selectedModelSelection === null &&
          state.selectionForNewSession === null,
      );

      await harness.update(
        createBaseProps({
          activeRepo: "/repo-b",
          repoSettings: createRepoSettings({
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-opus",
            variant: "extended",
            profileId: "planner-agent",
          }),
          loadCatalog: async () => {
            throw new Error("catalog unavailable");
          },
        }),
      );

      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-opus");
      expect(harness.getLatest().selectionForNewSession).toEqual({
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        profileId: "planner-agent",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("derives context usage from latest assistant message with descriptor fallback", async () => {
    const activeSession = createActiveSession({
      messages: [
        createAssistantMessage({
          totalTokens: 12,
          contextWindow: 40_000,
          outputLimit: 1000,
        }),
        createAssistantMessage({
          totalTokens: 24,
          providerId: "openai",
          modelId: "gpt-5",
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 24,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("prefers live session context usage before final assistant completion", async () => {
    const activeSession = createActiveSession({
      contextUsage: {
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      },
      messages: [
        createAssistantMessage({
          totalTokens: 12,
          contextWindow: 40_000,
          outputLimit: 1_000,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 35_022,
        contextWindow: 200_000,
        outputLimit: 8_192,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("falls back to the selected model context window when message + descriptor metadata are missing", async () => {
    const primaryModel = CATALOG.models[0];
    const secondaryModel = CATALOG.models[1];
    if (!primaryModel || !secondaryModel) {
      throw new Error("Expected catalog fixture models");
    }
    const catalogWithContextFallback: AgentModelCatalog = {
      ...CATALOG,
      models: [
        {
          ...primaryModel,
        },
        {
          ...secondaryModel,
          contextWindow: 100_000,
        },
      ],
    };
    const activeSession = createActiveSession({
      modelCatalog: catalogWithContextFallback,
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
      messages: [
        createAssistantMessage({
          totalTokens: 33,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 33,
        contextWindow: 100_000,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("uses an older assistant message for context usage when the latest tokenized one is incomplete", async () => {
    const activeSession = createActiveSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
      },
      messages: [
        createAssistantMessage({
          totalTokens: 11,
          contextWindow: 25_000,
        }),
        createAssistantMessage({
          totalTokens: 22,
        }),
      ],
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().activeSessionContextUsage).toEqual({
        totalTokens: 11,
        contextWindow: 25_000,
      });
    } finally {
      await harness.unmount();
    }
  });
});
