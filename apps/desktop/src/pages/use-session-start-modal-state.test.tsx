import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useSessionStartModalState } from "./use-session-start-modal-state";

enableReactActEnvironment();

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

type HookArgs = Parameters<typeof useSessionStartModalState>[0];

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
      variants: ["default"],
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
  overrides: Partial<RepoSettingsInput["agentDefaults"]> = {},
): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: "codex/",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  agentDefaults: {
    spec: {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    },
    planner: null,
    build: {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      opencodeAgent: "build-agent",
    },
    qa: null,
    ...overrides,
  },
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSessionStartModalState, initialProps);

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  repoSettings: createRepoSettings(),
  loadCatalog: async () => CATALOG,
  ...overrides,
});

describe("useSessionStartModalState", () => {
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

  test("initializes selection from repo role defaults", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.isCatalogLoading === false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-1",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Build Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "claude-sonnet");
    expect(harness.getLatest().selection).toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      opencodeAgent: "build-agent",
    });

    await harness.unmount();
  });

  test("normalizes stale defaults against the loaded catalog", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          spec: {
            providerId: "openai",
            modelId: "does-not-exist",
            variant: "legacy",
            opencodeAgent: "spec-agent",
          },
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.isCatalogLoading === false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-2",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");
    expect(harness.getLatest().selection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
  });

  test("resets draft selection on close", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.isCatalogLoading === false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-3",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");

    await harness.run(() => {
      const state = harness.getLatest();
      state.handleSelectModel("anthropic/claude-sonnet");
    });
    await harness.waitFor((state) => state.selection?.modelId === "claude-sonnet");

    await harness.run(() => {
      harness.getLatest().closeStartModal();
    });

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-3",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");
    expect(harness.getLatest().selection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
  });

  test("uses role defaults for modal initialization", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.isCatalogLoading === false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-4",
        role: "spec",
        scenario: "spec_initial",
        startMode: "reuse_latest",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");
    expect(harness.getLatest().selection).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    });

    await harness.unmount();
  });

  test("preserves caller-selected model when opening modal", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();
    await harness.waitFor((state) => state.isCatalogLoading === false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-5",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "none",
        selectedModel: {
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "default",
          opencodeAgent: "build-agent",
        },
        title: "Start Spec Session",
      });
    });

    await harness.waitFor((state) => state.selection?.modelId === "claude-sonnet");
    expect(harness.getLatest().selection).toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      opencodeAgent: "build-agent",
    });

    await harness.unmount();
  });
});
