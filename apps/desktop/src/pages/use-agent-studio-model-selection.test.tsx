import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  type AgentStudioModelSelectionState,
  useAgentStudioModelSelection,
} from "./use-agent-studio-model-selection";

enableReactActEnvironment();

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

type HookArgs = Parameters<typeof useAgentStudioModelSelection>[0];
type HookState = AgentStudioModelSelectionState;

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
});
