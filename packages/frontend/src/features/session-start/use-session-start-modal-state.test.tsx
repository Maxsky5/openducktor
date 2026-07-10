import { describe, expect, mock, test } from "bun:test";
import type { RepoRuntimeRef, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionStartMode } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { runtimeCatalogQueryKeys } from "@/state/queries/runtime-catalog";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createChecksStateContextValue,
  createDeferred,
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../../pages/agents/agent-studio-test-utils";
import { useSessionStartModalState } from "./use-session-start-modal-state";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSessionStartModalState>[0];
type HookHarnessArgs = HookArgs & {
  runtimeDefinitions: RuntimeDescriptor[];
};

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

const CODEX_CATALOG: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "codex/gpt-5.4-mini",
      providerId: "codex",
      providerName: "Codex",
      modelId: "gpt-5.4-mini",
      modelName: "GPT-5.4 Mini",
      variants: ["low", "medium"],
    },
  ],
  defaultModelsByProvider: {
    codex: "gpt-5.4-mini",
  },
};

const CLAUDE_CATALOG: AgentModelCatalog = {
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "default",
      providerId: "claude",
      providerName: "Claude",
      modelId: "default",
      modelName: "Default",
      variants: ["low", "medium", "high", "xhigh", "max"],
    },
  ],
  defaultModelsByProvider: {
    claude: "default",
  },
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

const FRESH_RUNTIME_KIND = runtimeKind("fresh-runtime");
const FRESH_RUNTIME_DESCRIPTOR = createRuntimeDescriptor({
  kind: FRESH_RUNTIME_KIND,
  label: "Fresh Runtime",
  supportedStartModes: ["fresh"],
});

const REUSE_ONLY_RUNTIME_KIND = runtimeKind("reuse-only-runtime");
const REUSE_ONLY_RUNTIME_DESCRIPTOR = createRuntimeDescriptor({
  kind: REUSE_ONLY_RUNTIME_KIND,
  label: "Reuse Only Runtime",
  supportedStartModes: ["reuse"],
});

const FORK_ONLY_RUNTIME_KIND = runtimeKind("fork-only-runtime");
const FORK_ONLY_RUNTIME_DESCRIPTOR = createRuntimeDescriptor({
  kind: FORK_ONLY_RUNTIME_KIND,
  label: "Fork Only Runtime",
  supportedStartModes: ["fork"],
});

const SESSION_START_TEST_RUNTIME_DEFINITIONS: RuntimeDescriptor[] = [
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  ALTERNATE_RUNTIME_DESCRIPTOR,
  REUSE_RUNTIME_DESCRIPTOR,
  FORK_RUNTIME_DESCRIPTOR,
  FRESH_RUNTIME_DESCRIPTOR,
  REUSE_ONLY_RUNTIME_DESCRIPTOR,
  FORK_ONLY_RUNTIME_DESCRIPTOR,
];

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

const createReadyRuntimeHealthMap = (
  runtimeDefinitions: RuntimeDescriptor[],
): RepoRuntimeHealthMap => {
  const definitionsByKind = new Map<RuntimeKind, RuntimeDescriptor>();
  for (const definition of [...SESSION_START_TEST_RUNTIME_DEFINITIONS, ...runtimeDefinitions]) {
    definitionsByKind.set(definition.kind, definition);
  }

  return Object.fromEntries(
    Array.from(definitionsByKind.values()).map((definition) => [
      definition.kind,
      createRepoRuntimeHealthFixture({ status: "ready" }),
    ]),
  ) as RepoRuntimeHealthMap;
};

const createHookHarness = (
  initialProps: HookHarnessArgs,
  options?: Parameters<typeof createSharedHookHarness>[2],
) => {
  const { runtimeDefinitions, ...hookProps } = initialProps;
  const runtimeDefinitionsContextRef = options?.runtimeDefinitionsContextRef ?? {
    current:
      options?.runtimeDefinitionsContext ??
      createRuntimeDefinitionsContextValue({
        runtimeDefinitions,
        availableRuntimeDefinitions: runtimeDefinitions,
      }),
  };
  const checksStateContext = options?.checksStateContext ?? createChecksStateContextValue();
  const repoRuntimeHealthContext =
    options?.repoRuntimeHealthContext ??
    createRepoRuntimeHealthContextValue({
      runtimeHealthByRuntime: createReadyRuntimeHealthMap(runtimeDefinitions),
    });
  const harness = createSharedHookHarness(useSessionStartModalState, hookProps, {
    ...options,
    runtimeDefinitionsContextRef,
    checksStateContext,
    repoRuntimeHealthContext,
  });
  return {
    ...harness,
    update: async (nextProps: HookHarnessArgs): Promise<void> => {
      runtimeDefinitionsContextRef.current = createRuntimeDefinitionsContextValue({
        runtimeDefinitions: nextProps.runtimeDefinitions,
        availableRuntimeDefinitions: nextProps.runtimeDefinitions,
      });
      const { runtimeDefinitions: _runtimeDefinitions, ...nextHookProps } = nextProps;
      await harness.update(nextHookProps);
    },
  };
};

const createBaseProps = (overrides: Partial<HookHarnessArgs> = {}): HookHarnessArgs => ({
  workspaceRepoPath: "/repo",
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

const createBuildRepoSettingsForRuntime = (runtimeKind: RuntimeKind): RepoSettingsInput => ({
  ...createRepoSettings({
    build: {
      runtimeKind,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
  }),
  defaultRuntimeKind: runtimeKind,
});

const createExistingSessionWithModel = ({
  description = "Reusable builder session",
  label = "Builder session",
  runtimeKind,
  sourceExternalSessionId,
  value,
}: {
  description?: string;
  label?: string;
  runtimeKind: RuntimeKind;
  sourceExternalSessionId?: string;
  value: string;
}) => ({
  value,
  sourceSession: {
    externalSessionId: sourceExternalSessionId ?? value,
    runtimeKind,
    workingDirectory: "/repo/worktree",
  },
  label,
  description,
  runtimeKind,
  selectedModel: {
    runtimeKind,
    providerId: "openai",
    modelId: "gpt-5",
    variant: "high",
    profileId: "spec-agent",
  },
});

describe("useSessionStartModalState", () => {
  test("waits for runtime readiness before loading the modal catalog", async () => {
    const loadCatalog = mock(async () => CATALOG);
    const repoRuntimeHealthContextRef = {
      current: createRepoRuntimeHealthContextValue({
        runtimeHealthByRuntime: {
          opencode: createRepoRuntimeHealthFixture({
            status: "not_started",
            runtime: {
              status: "not_started",
              stage: "idle",
              detail: "Runtime has not been started yet.",
            },
          }),
        },
      }),
    };
    const { initialCatalog: _initialCatalog, ...props } = createBaseProps({
      loadCatalog,
    });
    const harness = createHookHarness(props, { repoRuntimeHealthContextRef });

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        initialStartMode: "fresh",
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(loadCatalog).not.toHaveBeenCalled();
    expect(harness.getLatest().isCatalogLoading).toBe(true);

    repoRuntimeHealthContextRef.current = createRepoRuntimeHealthContextValue({
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
      },
    });
    await harness.update(props);

    expect(loadCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
  });

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

  test("uses the resolved visible selection as the base after catalog hydration", async () => {
    const catalogDeferred = createDeferred<AgentModelCatalog>();
    const loadCatalog = mock(async () => catalogDeferred.promise);
    const props = createBaseProps({
      loadCatalog,
      repoSettings: createRepoSettings({
        spec: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "does-not-exist",
          variant: "legacy",
          profileId: "spec-agent",
        },
      }),
    });
    delete props.initialCatalog;
    const harness = createHookHarness(props);

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

    await harness.run(() => {
      catalogDeferred.resolve(CATALOG);
    });
    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectVariant("high");
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

  test("clears previous runtime model while switching to a runtime with a loading catalog", async () => {
    const catalogDeferred = createDeferred<AgentModelCatalog>();
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      if (runtimeRef.runtimeKind === "claude") {
        return catalogDeferred.promise;
      }
      return CATALOG;
    });
    const harness = createHookHarness(
      createBaseProps({
        loadCatalog,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-3B",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selection?.modelId).toBe("gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectRuntime("claude");
    });

    expect(harness.getLatest().selectedRuntimeKind).toBe("claude");
    expect(harness.getLatest().selection).toBeNull();
    expect(harness.getLatest().modelOptions).toEqual([]);
    expect(harness.getLatest().variantOptions).toEqual([]);

    await harness.run(() => {
      catalogDeferred.resolve(CLAUDE_CATALOG);
    });
    await harness.waitFor((state) => state.selection?.runtimeKind === "claude");

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "default",
      variant: "low",
    });
    expect(harness.getLatest().variantOptions.map((option) => option.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    await harness.unmount();
  });

  test("clears stale model selection and exposes catalog errors when runtime catalog loading fails", async () => {
    const loadCatalog = mock(async (runtimeRef: RepoRuntimeRef) => {
      if (runtimeRef.runtimeKind === "claude") {
        throw new Error("Claude auth failed");
      }
      return CATALOG;
    });
    const harness = createHookHarness(
      createBaseProps({
        loadCatalog,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-3C",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().selection?.modelId).toBe("gpt-5");

    await harness.run(() => {
      harness.getLatest().handleSelectRuntime("claude");
    });
    await harness.waitFor((state) => state.catalogError === "Claude auth failed");

    expect(harness.getLatest().selectedRuntimeKind).toBe("claude");
    expect(harness.getLatest().selection).toBeNull();
    expect(harness.getLatest().modelOptions).toEqual([]);
    expect(harness.getLatest().variantOptions).toEqual([]);
    expect(harness.getLatest().isCatalogLoading).toBe(false);

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

  test("demotes reuse starts without existing sessions and keeps runtime options fresh-compatible", async () => {
    const harness = createHookHarness(
      createBaseProps({
        runtimeDefinitions: [
          FRESH_RUNTIME_DESCRIPTOR,
          REUSE_ONLY_RUNTIME_DESCRIPTOR,
          FORK_ONLY_RUNTIME_DESCRIPTOR,
        ],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-4",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        initialStartMode: "reuse",
        postStartAction: "kickoff",
        title: "Resume Builder Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("fresh");
    expect(harness.getLatest().runtimeOptions.map((option) => option.value)).toEqual([
      FRESH_RUNTIME_KIND,
    ]);

    await harness.unmount();
  });

  test("falls back from an unavailable fork start to fresh when no sessions exist", async () => {
    const harness = createHookHarness(
      createBaseProps({
        runtimeDefinitions: [
          FRESH_RUNTIME_DESCRIPTOR,
          REUSE_ONLY_RUNTIME_DESCRIPTOR,
          FORK_ONLY_RUNTIME_DESCRIPTOR,
        ],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-4B",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        initialStartMode: "fork",
        postStartAction: "kickoff",
        title: "Resume Builder Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("fresh");
    expect(harness.getLatest().runtimeOptions.map((option) => option.value)).toEqual([
      FRESH_RUNTIME_KIND,
    ]);

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
            sourceSession: {
              externalSessionId: "session-build-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
            sourceSession: {
              externalSessionId: "session-build-pr",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
    expect(loadCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });

    await harness.unmount();
  });

  test("loads the selected runtime catalog instead of reusing the initial catalog", async () => {
    const loadCatalog = mock(async ({ runtimeKind }: RepoRuntimeRef) => {
      return runtimeKind === "codex" ? CODEX_CATALOG : CATALOG;
    });
    const harness = createHookHarness(
      createBaseProps({
        loadCatalog,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      }),
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "agent_studio",
        taskId: "TASK-RUNTIME-SWITCH",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "none",
        title: "Start Spec Session",
      });
    });

    expect(harness.getLatest().modelOptions.map((option) => option.label)).toContain("GPT-5");

    await harness.run(() => {
      harness.getLatest().handleSelectRuntime("codex");
    });

    await harness.waitFor((state) =>
      state.modelOptions.some((option) => option.label === "GPT-5.4 Mini"),
    );
    expect(harness.getLatest().modelOptions.map((option) => option.label)).not.toContain("GPT-5");
    expect(loadCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "codex",
    });

    await harness.unmount();
  });

  test("fetches fresh modal catalog data instead of reusing stale shared runtime cache", async () => {
    const queryClient = new QueryClient();
    const claudeModel = CLAUDE_CATALOG.models[0];
    if (!claudeModel) {
      throw new Error("Expected Claude catalog fixture to include a model.");
    }
    const staleClaudeCatalog: AgentModelCatalog = {
      ...CLAUDE_CATALOG,
      models: [
        {
          ...claudeModel,
          variants: [],
        },
      ],
    };
    queryClient.setQueryData(runtimeCatalogQueryKeys.repo("/repo", "claude"), staleClaudeCatalog);
    const loadCatalog = mock(async ({ runtimeKind }: RepoRuntimeRef) => {
      return runtimeKind === "claude" ? CLAUDE_CATALOG : CATALOG;
    });
    const harness = createHookHarness(
      createBaseProps({
        loadCatalog,
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR],
      }),
      { queryClient },
    );

    await harness.mount();

    await harness.run(() => {
      harness.getLatest().openStartModal({
        source: "kanban",
        taskId: "TASK-FRESH-CLAUDE-CATALOG",
        role: "spec",
        launchActionId: "spec_initial",
        postStartAction: "kickoff",
        title: "Start Spec Session",
      });
    });

    await harness.run(() => {
      harness.getLatest().handleSelectRuntime("claude");
    });

    await harness.waitFor((state) => state.selection?.runtimeKind === "claude");

    expect(loadCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "claude",
    });
    expect(harness.getLatest().variantOptions.map((option) => option.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    await harness.unmount();
    queryClient.clear();
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
            sourceSession: {
              externalSessionId: "session-2",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "QA session 2",
            description: "Second session",
          },
          {
            value: "session-1",
            sourceSession: {
              externalSessionId: "session-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "QA session 1",
            description: "First session",
          },
        ],
        initialSourceSession: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        postStartAction: "kickoff",
        title: "Start QA Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["fresh", "reuse"]);
    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-1");

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
            sourceSession: {
              externalSessionId: "session-fallback",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
        initialSourceSession: {
          externalSessionId: "missing-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-fallback");
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
    expect(harness.getLatest().selectedSourceSessionValue).toBe("");

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
            sourceSession: {
              externalSessionId: "session-newer",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
            sourceSession: {
              externalSessionId: "session-older",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
        initialSourceSession: {
          externalSessionId: "session-older",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
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
      harness.getLatest().handleSelectSourceSessionValue("session-newer");
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
            sourceSession: {
              externalSessionId: "session-pr-2",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
            sourceSession: {
              externalSessionId: "session-pr-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
        initialSourceSession: {
          externalSessionId: "session-pr-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        postStartAction: "kickoff",
        title: "Start Builder Session",
      });
    });

    expect(harness.getLatest().availableStartModes).toEqual(["reuse", "fork"]);
    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-pr-1");
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
    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-pr-1");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectSourceSessionValue("session-pr-2");
    });

    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-pr-2");
    expect(harness.getLatest().selectedRuntimeKind).toBe("opencode");
    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "default",
      profileId: "build-agent",
    });

    await harness.run(() => {
      harness.getLatest().handleSelectStartMode("reuse");
    });

    expect(harness.getLatest().selectedStartMode).toBe("reuse");
    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-pr-2");
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
    const loadCatalog = mock(async ({ runtimeKind }: RepoRuntimeRef) => ({
      ...CATALOG,
      runtime:
        runtimeKind === FORK_RUNTIME_KIND ? FORK_RUNTIME_DESCRIPTOR : REUSE_RUNTIME_DESCRIPTOR,
    }));
    const harness = createHookHarness(
      createBaseProps({
        loadCatalog,
        repoSettings: createBuildRepoSettingsForRuntime(REUSE_RUNTIME_KIND),
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
          createExistingSessionWithModel({
            value: "session-pr-runtime",
            runtimeKind: REUSE_RUNTIME_KIND,
          }),
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
    const harness = createHookHarness(
      createBaseProps({
        repoSettings: createBuildRepoSettingsForRuntime(REUSE_RUNTIME_KIND),
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
          createExistingSessionWithModel({
            value: "session-pr-no-fork",
            runtimeKind: REUSE_RUNTIME_KIND,
          }),
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
          createExistingSessionWithModel({
            value: "session-pr-fork-runtime",
            description: "Builder session from a fork-only runtime",
            runtimeKind: FORK_RUNTIME_KIND,
          }),
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
            sourceSession: {
              externalSessionId: "session-with-model",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
            sourceSession: {
              externalSessionId: "session-without-model",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "Builder session without model",
            description: "Session without persisted model",
            selectedModel: null,
          },
        ],
        initialSourceSession: {
          externalSessionId: "session-with-model",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
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
      harness.getLatest().handleSelectSourceSessionValue("session-without-model");
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
            sourceSession: {
              externalSessionId: "session-valid",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
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
      harness.getLatest().handleSelectSourceSessionValue("missing-session");
    });

    expect(harness.getLatest().selectedSourceSessionValue).toBe("session-valid");
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
