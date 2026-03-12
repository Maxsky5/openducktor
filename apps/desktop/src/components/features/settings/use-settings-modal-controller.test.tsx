import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const loadSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => ({
  git: {
    defaultMergeMethod: "merge_commit",
  },
  repos: {
    "/repo": {
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/worktrees",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
  globalPromptOverrides: {},
}));

let refreshChecks = mock(async () => {});

mock.module("@/state", () => ({
  useWorkspaceState: () => ({
    activeRepo: "/repo",
    loadSettingsSnapshot,
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    saveSettingsSnapshot: async () => {},
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

mock.module("./use-settings-modal-prompt-validation", () => ({
  useSettingsModalPromptValidation: () => ({
    promptValidationState: {
      totalErrorCount: 0,
      globalErrorCount: 0,
      repoErrorCountByPath: {},
    },
    hasPromptValidationErrors: false,
    selectedRepoPromptValidationErrors: {},
    selectedRepoPromptValidationErrorCount: 0,
    globalPromptRoleTabErrorCounts: {
      shared: 0,
      spec: 0,
      planner: 0,
      build: 0,
      qa: 0,
    },
    selectedRepoPromptRoleTabErrorCounts: {
      shared: 0,
      spec: 0,
      planner: 0,
      build: 0,
      qa: 0,
    },
    settingsSectionErrorCountById: {
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
    },
  }),
}));

mock.module("./use-settings-modal-draft-actions", () => ({
  useSettingsModalDraftActions: ({ setSnapshotDraft }: { setSnapshotDraft: (value: unknown) => void }) => ({
    updateSelectedRepoConfig: () => setSnapshotDraft,
    updateGlobalGitConfig: () => setSnapshotDraft,
    updateGlobalPromptOverrides: () => setSnapshotDraft,
    updateRepoPromptOverrides: () => setSnapshotDraft,
    updateSelectedRepoAgentDefault: () => setSnapshotDraft,
    clearSelectedRepoAgentDefault: () => setSnapshotDraft,
  }),
}));

const { useSettingsModalController } = await import("./use-settings-modal-controller");

const createHookHarness = (open: boolean) =>
  createSharedHookHarness(({ isOpen }: { isOpen: boolean }) => useSettingsModalController(isOpen), {
    isOpen: open,
  });

describe("useSettingsModalController", () => {
  test("does not refresh diagnostics when the modal opens", async () => {
    refreshChecks = mock(async () => {});
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
});
