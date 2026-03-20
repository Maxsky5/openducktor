import { afterAll, describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const createSettingsSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  repos: {
    "/repo": {
      defaultRuntimeKind: "opencode",
      worktreeBasePath: undefined,
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
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

mock.module("@/state", () => ({
  useWorkspaceState: () => ({
    activeRepo: "/repo",
    workspaces: [
      {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
      },
    ],
    loadSettingsSnapshot,
    detectGithubRepository: async () => null,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  }),
  useChecksState: () => ({
    runtimeCheck: null,
    refreshChecks,
  }),
}));

mock.module("@/state/app-state-contexts", () => ({
  useRuntimeDefinitionsContext: () => ({
    runtimeDefinitions: [],
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
  }),
}));

mock.module("./use-settings-modal-branches-state", () => ({
  useSettingsModalBranchesState: () => ({
    selectedRepoBranches: [],
    isLoadingSelectedRepoBranches: false,
    selectedRepoBranchesError: null,
    retrySelectedRepoBranchesLoad: () => {},
  }),
}));

mock.module("./use-settings-modal-catalog-state", () => ({
  useSettingsModalCatalogState: () => ({
    getCatalogForRuntime: () => null,
    getCatalogErrorForRuntime: () => null,
    isCatalogLoadingForRuntime: () => false,
    isLoadingCatalog: false,
  }),
}));

const { useSettingsModalController } = await import("./use-settings-modal-controller");

const createHookHarness = (open: boolean) =>
  createSharedHookHarness(({ isOpen }: { isOpen: boolean }) => useSettingsModalController(isOpen), {
    isOpen: open,
  });

describe("useSettingsModalController", () => {
  afterAll(() => {
    mock.restore();
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
    await harness.update({ isOpen: true });

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

    await harness.update({ isOpen: false });
    await harness.update({ isOpen: true });
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

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
      expect(harness.getLatest().selectedRepoWorkspace?.configuredWorktreeBasePath).toBeNull();
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
      expect(harness.getLatest().saveError).toBe("Fix 1 dev server field error before saving.");
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});
