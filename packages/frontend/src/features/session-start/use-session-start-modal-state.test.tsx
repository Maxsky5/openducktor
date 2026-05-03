import { describe, expect, mock, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionStartMode } from "@openducktor/core";
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
  kind: "opencode",
  label: "Alternate Runtime",
} as const;

const runtimeKind = (kind: string): RuntimeKind => kind as unknown as RuntimeKind;

const createRuntimeDescriptor = ({
  kind,
  label,
  supportedStartModes,
}: {
  kind: RuntimeKind;
  label: string;
  supportedStartModes: AgentSessionStartMode[];
}): RuntimeDescriptor => ({
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind,
  label,
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    sessionLifecycle: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
      supportedStartModes,
      supportsSessionFork: supportedStartModes.includes("fork"),
      forkTargets: supportedStartModes.includes("fork") ? ["session"] : [],
    },
  },
});

const REUSE_RUNTIME_KIND = runtimeKind("reuse-runtime");
const FORK_RUNTIME_KIND = runtimeKind("fork-runtime");
const REUSE_RUNTIME_DESCRIPTOR = createRuntimeDescriptor({
  kind: REUSE_RUNTIME_KIND,
  label: "Reuse Runtime",
  supportedStartModes: ["fresh", "reuse"],
});
const FORK_RUNTIME_DESCRIPTOR = createRuntimeDescriptor({
  kind: FORK_RUNTIME_KIND,
  label: "Fork Runtime",
  supportedStartModes: ["fresh", "fork"],
});

const createRepoSettings = (
  overrides: Partial<RepoSettingsInput["agentDefaults"]> = {},
): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
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
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
  },
  branches: [
    { name: "main", isCurrent: true, isRemote: false },
    { name: "origin/main", isCurrent: false, isRemote: true },
    { name: "origin/release/2026.04", isCurrent: false, isRemote: true },
  ],
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
        launchActionId: "build_implementation_start",
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
        launchActionId: "spec_initial",
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
        launchActionId: "spec_initial",
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
        launchActionId: "spec_initial",
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
        launchActionId: "spec_initial",
        initialStartMode: "reuse",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("fresh");

    await harness.unmount();
  });

  test("shows target branch selection for builder implementation starts and defaults to repo settings", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-5",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().showTargetBranchSelector).toBe(true);
    expect(harness.getLatest().selectedTargetBranch).toBe("refs/remotes/origin/main");

    await harness.unmount();
  });

  test("does not show target branch selection for builder review flows", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-6",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        initialTargetBranch: {
          remote: "origin",
          branch: "release/2026.04",
        },
        postStartAction: "none",
        title: "Resume Builder Session",
      });
    });

    expect(harness.getLatest().showTargetBranchSelector).toBe(false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-6B",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-build-1",
            label: "Builder session 1",
            description: "Latest builder session",
            selectedModel: null,
          },
        ],
        postStartAction: "kickoff",
        title: "Apply Human Changes",
      });
    });

    expect(harness.getLatest().showTargetBranchSelector).toBe(false);

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-6C",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-build-pr",
            label: "Builder session PR",
            description: "Builder session for PR generation",
            selectedModel: null,
          },
        ],
        postStartAction: "kickoff",
        title: "Start PR Generation",
      });
    });

    expect(harness.getLatest().showTargetBranchSelector).toBe(true);

    await harness.unmount();
  });

  test("keeps the selected target branch in combobox value format after selection changes", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-7",
        role: "build",
        launchActionId: "build_implementation_start",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    await harness.run(() => {
      harness.getLatest().handleSelectTargetBranch("refs/remotes/origin/beta");
    });

    expect(harness.getLatest().selectedTargetBranch).toBe("refs/remotes/origin/beta");

    await harness.unmount();
  });

  test("injects an upstream target branch option that matches the initialized selector value", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-8",
        role: "build",
        launchActionId: "build_implementation_start",
        initialTargetBranch: {
          branch: "@{upstream}",
        },
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selectedTargetBranch).toBe("@{upstream}");
    expect(harness.getLatest().targetBranchOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "@{upstream}",
          label: "@{upstream}",
        }),
      ]),
    );

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
        launchActionId: "spec_initial",
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
        launchActionId: "spec_initial",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");

    await harness.unmount();
  });

  test("recovers requested runtime selection after runtime definitions load", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const baseProps = createBaseProps({
      loadCatalog,
      runtimeDefinitions: [],
    });
    const { initialCatalog: _initialCatalog, ...initialProps } = baseProps;
    const harness = createHookHarness(initialProps);

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-5B",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selectedRuntimeKind).toBeNull();
    expect(loadCatalog).not.toHaveBeenCalled();

    await harness.update({
      ...initialProps,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    });

    await harness.waitFor((state) => state.selectedRuntimeKind === "opencode");
    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });
    expect(loadCatalog).toHaveBeenCalledWith("/repo", "opencode");

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
        launchActionId: "spec_initial",
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

  test("forces fresh mode for fresh-only launch actions even when reuse is requested", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-6",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh"]);
    expect(harness.getLatest().selectedStartMode).toBe("fresh");

    await harness.unmount();
  });

  test("initializes reusable session selection for reuse-capable launch actions", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-7",
        role: "qa",
        launchActionId: "qa_review",
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
        initialSourceExternalSessionId: "session-1",
        postStartAction: "kickoff",
        title: "Start QA Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh", "reuse"]);
    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-1");

    await harness.unmount();
  });

  test("falls back to the first valid reuse source session when the initial source id is stale", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-7A",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-fallback",
            label: "Builder session fallback",
            description: "Fallback builder session",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
        ],
        initialSourceExternalSessionId: "missing-session",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-fallback");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

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
        launchActionId: "qa_review",
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
        launchActionId: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-newer",
            label: "Builder session 2",
            description: "Latest builder session",
            selectedModel: {
              runtimeKind: "opencode",
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
        initialSourceExternalSessionId: "session-older",
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

    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("restores source-session model state when switching back to reuse for pull request generation", async () => {
    const harness = createHookHarness(
      createBaseProps({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, ALTERNATE_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-PR",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-pr-2",
            label: "Builder session 2",
            description: "Latest builder session",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              variant: "default",
              profileId: "build-agent",
            },
          },
          {
            value: "session-pr-1",
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
        initialSourceExternalSessionId: "session-pr-1",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["reuse", "fork"]);
    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-pr-1");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("fork");
    });

    expect(harness.getLatest().selectedStartMode).toBe("fork");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-pr-1");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectSourceSession("session-pr-2");
    });

    expect(harness.getLatest().selectedSourceSessionId).toBe("session-pr-2");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("reuse");
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionId).toBe("session-pr-2");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.unmount();
  });

  test("filters runtime options by the selected start mode without selecting fallbacks", async () => {
    const repoSettings = {
      ...createRepoSettings({
        build: {
          runtimeKind: REUSE_RUNTIME_KIND,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        },
      }),
      defaultRuntimeKind: REUSE_RUNTIME_KIND,
    };
    const harness = createHookHarness(
      createBaseProps({
        repoSettings,
        runtimeDefinitions: [REUSE_RUNTIME_DESCRIPTOR, FORK_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-PR-RUNTIME-MODE",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-pr-runtime",
            label: "Builder session",
            description: "Reusable builder session",
            selectedModel: {
              runtimeKind: REUSE_RUNTIME_KIND,
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
        ],
        postStartAction: "kickoff",
        title: "Start PR Generation",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().runtimeOptions.map((option) => option.value)).toEqual([
      REUSE_RUNTIME_KIND,
    ]);
    expect(harness.getLatest().selectedRuntimeKind).toBe(REUSE_RUNTIME_KIND);

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("fork");
    });

    expect(harness.getLatest().runtimeOptions.map((option) => option.value)).toEqual([
      FORK_RUNTIME_KIND,
    ]);
    await harness.waitFor((state) => state.selectedRuntimeKind === null);
    await harness.waitFor((state) => state.selection === null);

    await harness.run(() => {
      harness.getLatest().handleSelectRuntime(FORK_RUNTIME_KIND);
    });

    await harness.waitFor((state) => state.selectedRuntimeKind === FORK_RUNTIME_KIND);
    await harness.waitFor((state) => state.selection?.runtimeKind === FORK_RUNTIME_KIND);

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("reuse");
    });

    expect(harness.getLatest().runtimeOptions.map((option) => option.value)).toEqual([
      REUSE_RUNTIME_KIND,
    ]);
    await harness.waitFor((state) => state.selectedRuntimeKind === REUSE_RUNTIME_KIND);
    await harness.waitFor((state) => state.selection?.runtimeKind === REUSE_RUNTIME_KIND);

    await harness.unmount();
  });

  test("clears runtime and model selection when no runtime supports the selected mode", async () => {
    const repoSettings = {
      ...createRepoSettings({
        build: {
          runtimeKind: REUSE_RUNTIME_KIND,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        },
      }),
      defaultRuntimeKind: REUSE_RUNTIME_KIND,
    };
    const harness = createHookHarness(
      createBaseProps({
        repoSettings,
        runtimeDefinitions: [REUSE_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-PR-NO-FORK-RUNTIME",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-pr-no-fork",
            label: "Builder session",
            description: "Reusable builder session",
            selectedModel: {
              runtimeKind: REUSE_RUNTIME_KIND,
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
        ],
        postStartAction: "kickoff",
        title: "Start PR Generation",
      });
    });

    expect(harness.getLatest().selectedRuntimeKind).toBe(REUSE_RUNTIME_KIND);

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("fork");
    });

    expect(harness.getLatest().runtimeOptions).toEqual([]);
    await harness.waitFor((state) => state.selectedRuntimeKind === null);
    await harness.waitFor((state) => state.selection === null);

    await harness.unmount();
  });

  test("does not reuse a source-session runtime that lacks reuse support", async () => {
    const harness = createHookHarness(
      createBaseProps({
        runtimeDefinitions: [FORK_RUNTIME_DESCRIPTOR],
        repoSettings: {
          ...createRepoSettings(),
          defaultRuntimeKind: FORK_RUNTIME_KIND,
        },
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-PR-REUSE-INCOMPATIBLE",
        role: "build",
        launchActionId: "build_pull_request_generation",
        existingSessionOptions: [
          {
            value: "session-pr-fork-runtime",
            label: "Builder session",
            description: "Builder session from a fork-only runtime",
            selectedModel: {
              runtimeKind: FORK_RUNTIME_KIND,
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "spec-agent",
            },
          },
        ],
        postStartAction: "kickoff",
        title: "Start PR Generation",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().runtimeOptions).toEqual([]);
    await harness.waitFor((state) => state.selectedRuntimeKind === null);
    await harness.waitFor((state) => state.selection === null);

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
        launchActionId: "build_after_human_request_changes",
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
        initialSourceExternalSessionId: "session-with-model",
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

  test("normalizes a stale source session id back to the first valid option in reuse mode", async () => {
    const harness = createHookHarness(createBaseProps());

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-10A",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-valid",
            label: "Builder session valid",
            description: "Valid builder session",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              variant: "default",
              profileId: "build-agent",
            },
          },
        ],
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    await harness.run(() => {
      harness.getLatest().handleSelectSourceSession("missing-session");
    });

    expect(harness.getLatest().selectedSourceSessionId).toBe("session-valid");
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
