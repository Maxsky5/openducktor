import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../../pages/agents/agent-studio-test-utils";
import { useSessionStartModalState } from "./use-session-start-modal-state";

enableReactActEnvironment();

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

const ALTERNATE_RUNTIME_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "alternate-runtime",
  label: "Alternate Runtime",
} as const;

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
  devServers: [],
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
  test("initializes selection from repo role defaults", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-1",
        role: "build",
        scenario: "build_implementation_start",
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

  test("falls back to a valid start mode when initialStartMode is not allowed", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-3",
        role: "spec",
        scenario: "spec_initial",
        initialStartMode: "reuse",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("fresh");

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

  test("forces fresh mode for fresh-only scenarios even when reuse is requested", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-6",
        role: "spec",
        scenario: "spec_initial",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh"]);
    expect(harness.getLatest().selectedStartMode).toBe("fresh");

    await harness.unmount();
  });

  test("initializes reusable session selection for reuse-capable scenarios", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-7",
        role: "qa",
        scenario: "qa_review",
        existingSessionOptions: [
          {
            value: "session-2",
            label: "QA session 2",
            description: "Second session",
          },
          {
            value: "session-1",
            label: "QA session 1",
            description: "First session",
          },
        ],
        initialSourceSessionId: "session-1",
        postStartAction: "kickoff",
        title: "Start QA Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh", "reuse"]);
    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-1");

    await harness.unmount();
  });

  test("defaults to fresh when reuse is requested but no reusable sessions exist", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-8",
        role: "qa",
        scenario: "qa_review",
        existingSessionOptions: [],
        postStartAction: "kickoff",
        title: "Start QA Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh", "reuse"]);
    expect(harness.getLatest().selectedStartMode).toBe("fresh");
    expect(harness.getLatest().selectedSourceSessionId).toBe("");

    await harness.unmount();
  });

  test("locks selection to selected source session model in reuse mode", async () => {
    const harness = createHookHarness(
      createBaseProps({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, ALTERNATE_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-9",
        role: "build",
        scenario: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-newer",
            label: "Builder session 2",
            description: "Latest builder session",
            selectedModel: {
              runtimeKind: "alternate-runtime",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              variant: "default",
              profileId: "build-agent",
            },
          },
          {
            value: "session-older",
            label: "Builder session 1",
            description: "Older builder session",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
        ],
        initialSourceSessionId: "session-older",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectSourceSession("session-newer");
    });

    expect(harness.getLatest().selectedRuntimeKind).toBe("alternate-runtime");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "alternate-runtime",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("clears locked selection when reused source session has no model", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-10",
        role: "build",
        scenario: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-with-model",
            label: "Builder session with model",
            description: "Session with persisted model",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
          {
            value: "session-without-model",
            label: "Builder session without model",
            description: "Session without persisted model",
            selectedModel: null,
          },
        ],
        initialSourceSessionId: "session-with-model",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectSourceSession("session-without-model");
    });

    expect(harness.getLatest().selection).toBeNull();

    await harness.unmount();
  });
});
