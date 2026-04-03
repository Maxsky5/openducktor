import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDefaultAutopilotSettings, type SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { SettingsModalController } from "./use-settings-modal-controller";

enableReactActEnvironment();

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
const useSettingsModalCatalogStateMock = mock(() => ({
  getCatalogForRuntime: () => null,
  getCatalogErrorForRuntime: () => null,
  isCatalogLoadingForRuntime: () => false,
  isLoadingCatalog: false,
}));

let useSettingsModalController: (input: {
  open: boolean;
  shouldLoadCatalog: boolean;
}) => SettingsModalController;

const createHookHarness = (open: boolean, shouldLoadCatalog = false) =>
  createSharedHookHarness(
    ({ isOpen, shouldLoad }: { isOpen: boolean; shouldLoad: boolean }) =>
      useSettingsModalController({
        open: isOpen,
        shouldLoadCatalog: shouldLoad,
      }),
    {
      isOpen: open,
      shouldLoad: shouldLoadCatalog,
    },
  );

describe("useSettingsModalController", () => {
  const registerModuleMocks = (): void => {
    mock.module("@/state/app-state-provider", () => ({
      AppStateProvider: ({ children }: { children: unknown }) => children,
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
      },
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
      useSpecState: () => {
        throw new Error("useSpecState is not used in this test");
      },
      useTasksState: () => {
        throw new Error("useTasksState is not used in this test");
      },
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
      useSettingsModalCatalogState: useSettingsModalCatalogStateMock,
    }));
  };

  beforeEach(async () => {
    registerModuleMocks();
    ({ useSettingsModalController } = await import("./use-settings-modal-controller"));
  });

  afterEach(() => {
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
    await harness.update({ isOpen: true, shouldLoad: false });

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

    await harness.update({ isOpen: false, shouldLoad: false });
    await harness.update({ isOpen: true, shouldLoad: false });
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(nextRefreshChecks).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("does not enable catalog loading unless the agents section requests it", async () => {
    useSettingsModalCatalogStateMock.mockClear();

    const harness = createHookHarness(true, false);
    await harness.mount();
    await harness.waitFor((state) => state.snapshotDraft !== null);

    expect(useSettingsModalCatalogStateMock).toHaveBeenCalled();
    const catalogCalls = useSettingsModalCatalogStateMock.mock.calls as unknown as Array<
      [{ enabled: boolean; selectedRepoPath: string | null }]
    >;
    const disabledCall = catalogCalls.find((call) => call[0].enabled === false);
    expect(disabledCall?.[0]).toMatchObject({
      enabled: false,
    });

    await harness.update({ isOpen: true, shouldLoad: true });

    const enabledCall = [...catalogCalls].reverse().find((call) => call[0].enabled === true);
    expect(enabledCall?.[0]).toMatchObject({
      enabled: true,
      selectedRepoPath: "/repo",
    });

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
      expect(harness.getLatest().saveError).toBe(
        "Fix 1 dev server field error in the selected repository before saving.",
      );
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});
