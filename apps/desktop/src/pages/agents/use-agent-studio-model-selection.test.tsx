import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;
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
  agents: [
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
  agents: [
    {
      name: "planner-agent",
      mode: "primary",
      hidden: false,
      color: "#0ea5e9",
    },
  ],
};

const createRepoSettings = (
  specDefault: RepoSettingsInput["agentDefaults"]["spec"] | null,
): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: "codex/",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec-agent",
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
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("uses repo role defaults when available", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "spec-agent",
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.selectedModelSelection?.variant === "high");

    const state = harness.getLatest();
    expect(state.selectedModelSelection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "build-agent",
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
  });

  test("falls back to composer catalog colors and loading state when session catalog is unavailable", async () => {
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

    await harness.mount();
    await harness.waitFor((state) => state.agentOptions.length > 0);

    const state = harness.getLatest();
    expect(state.isSelectionCatalogLoading).toBe(false);
    expect(state.activeSessionAgentColors).toMatchObject({
      "spec-agent": "#f59e0b",
    });

    await harness.unmount();
  });

  test("keeps loading while no catalog source is available for an active session", async () => {
    const deferredCatalog = createDeferred<AgentModelCatalog>();
    const activeSession = createActiveSession({
      modelCatalog: null,
      isLoadingModelCatalog: true,
    });

    const harness = createHookHarness(
      createBaseProps({
        activeSession,
        loadCatalog: async () => deferredCatalog.promise,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().isSelectionCatalogLoading).toBe(true);

    await harness.run(() => {
      deferredCatalog.resolve(CATALOG);
    });
    await harness.waitFor((state) => state.isSelectionCatalogLoading === false);

    await harness.unmount();
  });

  test("invalidates composer catalog and ignores stale repo loads when active repo changes", async () => {
    const repoALoad = createDeferred<AgentModelCatalog>();
    const repoBLoad = createDeferred<AgentModelCatalog>();
    const loadCatalog = mock((repoPath: string): Promise<AgentModelCatalog> => {
      if (repoPath === "/repo-a") {
        return repoALoad.promise;
      }
      if (repoPath === "/repo-b") {
        return repoBLoad.promise;
      }
      return Promise.reject(new Error(`Unexpected repo path: ${repoPath}`));
    });

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
      expect(loadCatalog.mock.calls[0]).toEqual(["/repo-a"]);
      expect(loadCatalog.mock.calls[1]).toEqual(["/repo-b"]);

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
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        opencodeAgent: "planner-agent",
      });
    } finally {
      repoALoad.resolve(CATALOG);
      repoBLoad.resolve(ALTERNATE_CATALOG);
      await harness.unmount();
    }
  });

  test("uses defaults from the newly selected repository after switching repos", async () => {
    const loadCatalog = mock(async (repoPath: string): Promise<AgentModelCatalog> => {
      if (repoPath === "/repo-a") {
        return CATALOG;
      }
      if (repoPath === "/repo-b") {
        return ALTERNATE_CATALOG;
      }
      throw new Error(`Unexpected repo path: ${repoPath}`);
    });

    const harness = createHookHarness(
      createBaseProps({
        activeRepo: "/repo-a",
        repoSettings: createRepoSettings({
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "build-agent",
        }),
        loadCatalog,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
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
            providerId: "anthropic",
            modelId: "claude-opus",
            variant: "extended",
            opencodeAgent: "planner-agent",
          }),
          loadCatalog,
        }),
      );

      await harness.waitFor((state) => state.selectedModelSelection?.modelId === "claude-opus");

      expect(harness.getLatest().selectedModelSelection).toEqual({
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        opencodeAgent: "planner-agent",
      });
      expect(harness.getLatest().selectionForNewSession).toEqual({
        providerId: "anthropic",
        modelId: "claude-opus",
        variant: "extended",
        opencodeAgent: "planner-agent",
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
});
