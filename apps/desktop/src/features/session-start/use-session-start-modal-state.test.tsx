import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../../pages/agents/agent-studio-test-utils";
import { useSessionStartModalState } from "./use-session-start-modal-state";

enableReactActEnvironment();

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

type HookArgs = Parameters<typeof useSessionStartModalState>[0];

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
      variants: ["default"],
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

const createRepoSettings = (
  overrides: Partial<RepoSettingsInput["agentDefaults"]> = {},
): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: null,
    build: {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
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
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  initialCatalog: CATALOG,
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

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-1",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("normalizes stale defaults against the loaded catalog", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          spec: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "does-not-exist",
            variant: "legacy",
            profileId: "spec-agent",
          },
        }),
      }),
    );

    await harness.mount();

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

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("resets draft selection on close", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

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

    expect(harness.getLatest().selection?.modelId).toBe("gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectModel("anthropic/claude-sonnet");
    });

    expect(harness.getLatest().selection?.modelId).toBe("claude-sonnet");

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

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("uses role defaults for modal initialization", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

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

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.unmount();
  });

  test("falls back to repo default runtime when role runtime is missing", async () => {
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createRepoSettings({
          spec: {
            runtimeKind: undefined as never,
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "spec-agent",
          },
        }),
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-5",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");

    await harness.unmount();
  });

  test("preserves caller-selected model when opening modal", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-5",
        role: "spec",
        scenario: "spec_initial",
        startMode: "fresh",
        postStartAction: "none",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "default",
          profileId: "build-agent",
        },
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.unmount();
  });
});
