import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDefaultAutopilotSettings,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type RuntimeKind,
  type SettingsSnapshot,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import {
  ChecksStateContext,
  RuntimeDefinitionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { repoBranchesQueryOptions } from "@/state/queries/git";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useSettingsModalController } from "./use-settings-modal-controller";

enableReactActEnvironment();

const CODEX_RUNTIME_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "codex",
  label: "Codex",
  description: "Codex runtime",
} satisfies RuntimeDescriptor;

const createSettingsSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  kanban: {
    doneVisibleDays: 1,
  },
  autopilot: createDefaultAutopilotSettings(),
  workspaces: {
    repo: {
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      worktreeBasePath: undefined,
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      trustedHooksFingerprint: undefined,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
    "repo-two": {
      workspaceId: "repo-two",
      workspaceName: "Repo Two",
      repoPath: "/repo-two",
      defaultRuntimeKind: "codex",
      worktreeBasePath: undefined,
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      trustedHooksFingerprint: undefined,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
  globalPromptOverrides: {},
});

const loadSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => createSettingsSnapshot());

let refreshChecks = mock(async () => {});
let saveGlobalGitConfig = mock(async () => {});
let saveSettingsSnapshot = mock(async () => {});
let workspaceRecords: WorkspaceRecord[] = [
  {
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
    effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
  },
  {
    workspaceId: "repo-two",
    workspaceName: "Repo Two",
    repoPath: "/repo-two",
    isActive: false,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo-two",
    effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo-two",
  },
];
let runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];

const EMPTY_BRANCHES: [] = [];

const createHookHarness = (
  open: boolean,
  shouldLoadCatalog = false,
  options?: {
    loadRepoRuntimeCatalog?: (
      repoPath: string,
      runtimeKind: RuntimeKind,
    ) => Promise<AgentModelCatalog>;
  },
) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(repoBranchesQueryOptions("/repo").queryKey, EMPTY_BRANCHES);
  queryClient.setQueryData(repoBranchesQueryOptions("/repo-two").queryKey, EMPTY_BRANCHES);

  const workspaceState = {
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: workspaceRecords,
    activeWorkspace: workspaceRecords[0] ?? null,
    branches: EMPTY_BRANCHES,
    activeBranch: null,
    addWorkspace: async () => {},
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("loadRepoSettings is not used in this test");
    },
    saveRepoSettings: async () => {
      throw new Error("saveRepoSettings is not used in this test");
    },
    loadSettingsSnapshot,
    detectGithubRepository: async () => null,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  } satisfies React.ComponentProps<typeof WorkspaceStateContext.Provider>["value"];

  const checksState = {
    runtimeCheck: null,
    beadsCheck: null,
    runtimeCheckFailureKind: null,
    beadsCheckFailureKind: null,
    runtimeHealthByRuntime: {},
    isLoadingChecks: false,
    refreshChecks,
  } satisfies React.ComponentProps<typeof ChecksStateContext.Provider>["value"];

  const runtimeDefinitionsContext = {
    runtimeDefinitions,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => runtimeDefinitions,
    loadRepoRuntimeCatalog:
      options?.loadRepoRuntimeCatalog ??
      (async () => {
        throw new Error("catalog loading is not configured for this test");
      }),
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  } satisfies React.ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

  const wrapper = ({ children }: React.PropsWithChildren): React.ReactElement => (
    <WorkspaceStateContext.Provider value={workspaceState}>
      <ChecksStateContext.Provider value={checksState}>
        <QueryClientProvider client={queryClient}>
          <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsContext}>
            {children}
          </RuntimeDefinitionsContext.Provider>
        </QueryClientProvider>
      </ChecksStateContext.Provider>
    </WorkspaceStateContext.Provider>
  );

  return createSharedHookHarness(
    ({ isOpen, shouldLoad }: { isOpen: boolean; shouldLoad: boolean }) =>
      useSettingsModalController({
        open: isOpen,
        shouldLoadCatalog: shouldLoad,
      }),
    {
      isOpen: open,
      shouldLoad: shouldLoadCatalog,
    },
    { wrapper },
  );
};

describe("useSettingsModalController", () => {
  beforeEach(async () => {
    workspaceRecords = [
      {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
      },
      {
        workspaceId: "repo-two",
        workspaceName: "Repo Two",
        repoPath: "/repo-two",
        isActive: false,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo-two",
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo-two",
      },
    ];
    runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];
    loadSettingsSnapshot.mockClear();
  });

  test("does not refresh diagnostics when the modal opens", async () => {
    refreshChecks = mock(async () => {});
    saveGlobalGitConfig = mock(async () => {});
    saveSettingsSnapshot = mock(async () => {});
    loadSettingsSnapshot.mockClear();

    const harness = createHookHarness(true);
    await harness.mount();
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(refreshChecks).toHaveBeenCalledTimes(0);

    const nextRefreshChecks = mock(async () => {});
    refreshChecks = nextRefreshChecks;
    await harness.update({ isOpen: true, shouldLoad: false });

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

    await harness.update({ isOpen: false, shouldLoad: false });
    await harness.update({ isOpen: true, shouldLoad: false });
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("does not enable catalog loading unless the agents section requests it", async () => {
    const loadRepoRuntimeCatalog = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    }));

    const harness = createHookHarness(true, false, { loadRepoRuntimeCatalog });
    await harness.mount();
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);
    expect(harness.getLatest().getCatalogForRuntime("opencode")).toBeNull();

    await harness.update({ isOpen: true, shouldLoad: true });
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo", "opencode");

    await harness.unmount();
  });

  test("recalculates catalog runtime kinds when the selected repo changes", async () => {
    const loadRepoRuntimeCatalog = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    }));

    const harness = createHookHarness(true, true, { loadRepoRuntimeCatalog });
    await harness.mount();
    await harness.waitFor((state) => state.snapshotDraft !== null);
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null);

    loadRepoRuntimeCatalog.mockClear();

    await harness.run((state) => {
      state.setSelectedWorkspaceId("repo-two");
    });
    await harness.waitFor((state) => state.getCatalogForRuntime("codex") !== null);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo-two", "codex");

    await harness.unmount();
  });

  test("saves chat-only edits through the settings snapshot query path", async () => {
    refreshChecks = mock(async () => {});
    saveGlobalGitConfig = mock(async () => {});
    saveSettingsSnapshot = mock(async () => {});
    loadSettingsSnapshot.mockClear();

    const harness = createHookHarness(true);
    await harness.mount();
    await harness.waitFor((state) => state.snapshotDraft !== null);

    await harness.run((state) => {
      state.updateGlobalChatSettings((chat) => ({
        ...chat,
        showThinkingMessages: true,
      }));
    });

    let didSave = false;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(saveGlobalGitConfig).toHaveBeenCalledTimes(0);
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(saveSettingsSnapshot).toHaveBeenCalledWith({
      ...createSettingsSnapshot(),
      chat: {
        showThinkingMessages: true,
      },
    });

    await harness.unmount();
  });

  test("keeps the override blank when unset and exposes the effective worktree path", async () => {
    const harness = createHookHarness(true);

    try {
      await harness.mount();
      await harness.waitFor((state) => state.snapshotDraft !== null);

      expect(harness.getLatest().selectedRepoConfig?.worktreeBasePath).toBeUndefined();
      expect(harness.getLatest().selectedRepoDefaultWorktreeBasePath).toBe(
        "/Users/dev/.openducktor/worktrees/repo",
      );
      expect(harness.getLatest().selectedRepoEffectiveWorktreeBasePath).toBe(
        "/Users/dev/.openducktor/worktrees/repo",
      );
      expect(harness.getLatest().selectedWorkspace?.configuredWorktreeBasePath).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("previews the draft override before the repository settings are saved", async () => {
    const harness = createHookHarness(true);

    try {
      await harness.mount();
      await harness.waitFor((state) => state.snapshotDraft !== null);

      await harness.run(async (state) => {
        state.updateSelectedRepoConfig((repoConfig) => ({
          ...repoConfig,
          worktreeBasePath: " /tmp/override-worktrees ",
        }));
      });

      expect(harness.getLatest().selectedRepoDefaultWorktreeBasePath).toBe(
        "/Users/dev/.openducktor/worktrees/repo",
      );
      expect(harness.getLatest().selectedRepoEffectiveWorktreeBasePath).toBe(
        "/tmp/override-worktrees",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("blocks saving when a dev server draft has blank required fields", async () => {
    saveSettingsSnapshot = mock(async () => {});

    const harness = createHookHarness(true);

    try {
      await harness.mount();
      await harness.waitFor((state) => state.snapshotDraft !== null);

      await harness.run((state) => {
        state.updateSelectedRepoConfig((repoConfig) => ({
          ...repoConfig,
          devServers: [{ id: "frontend", name: "Frontend", command: "" }],
        }));
      });

      expect(harness.getLatest().hasRepoScriptValidationErrors).toBe(true);
      expect(harness.getLatest().showRepoScriptValidationErrors).toBe(false);
      expect(harness.getLatest().repoScriptValidationErrorCount).toBe(1);
      expect(harness.getLatest().selectedRepoDevServerValidationErrors).toEqual({
        frontend: {
          command: "Command is required.",
        },
      });

      let didSave = true;
      await harness.run(async (state) => {
        didSave = await state.submit();
      });

      expect(didSave).toBe(false);
      expect(harness.getLatest().showRepoScriptValidationErrors).toBe(true);
      expect(harness.getLatest().saveError).toBe(
        "Fix 1 dev server field error in the selected repository before saving.",
      );
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces agent default runtime validation errors before saving", async () => {
    saveSettingsSnapshot = mock(async () => {});

    const harness = createHookHarness(true);

    try {
      await harness.mount();
      await harness.waitFor((state) => state.snapshotDraft !== null);

      await harness.run((state) => {
        state.updateSelectedRepoAgentDefault("spec", "providerId", "openai");
        state.updateSelectedRepoAgentDefault("spec", "modelId", "gpt-5");
        state.updateSelectedRepoAgentDefault("spec", "runtimeKind", "   ");
      });

      let didSave = true;
      await harness.run(async (state) => {
        didSave = await state.submit();
      });

      expect(didSave).toBe(false);
      expect(harness.getLatest().saveError).toBe(
        "Specification agent default runtime kind is required when provider and model are configured.",
      );
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces blank repo default runtime validation errors before saving", async () => {
    saveSettingsSnapshot = mock(async () => {});

    const harness = createHookHarness(true);

    try {
      await harness.mount();
      await harness.waitFor((state) => state.snapshotDraft !== null);

      await harness.run((state) => {
        state.updateSelectedRepoConfig((repoConfig) => ({
          ...repoConfig,
          defaultRuntimeKind: "   ",
        }));
      });

      let didSave = true;
      await harness.run(async (state) => {
        didSave = await state.submit();
      });

      expect(didSave).toBe(false);
      expect(harness.getLatest().saveError).toBe("Default runtime kind cannot be blank.");
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});
