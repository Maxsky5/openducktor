import { afterAll, describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { SETTINGS_SNAPSHOT_UPDATED_EVENT } from "@/pages/agents/use-agent-studio-chat-settings";
import { REPO_SETTINGS_UPDATED_EVENT } from "@/pages/agents/use-agent-studio-repo-settings";

enableReactActEnvironment();

const createSettingsSnapshot = (): SettingsSnapshot => ({
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
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
});

const loadSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => createSettingsSnapshot());

let refreshChecks = mock(async () => {});
let saveGlobalGitConfig = mock(async () => {});
let saveSettingsSnapshot = mock(async () => {});

mock.module("@/state", () => ({
  useWorkspaceState: () => ({
    activeRepo: "/repo",
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

  test("saves chat-only edits through settings snapshot without repo update events", async () => {
    refreshChecks = mock(async () => {});
    saveGlobalGitConfig = mock(async () => {});
    saveSettingsSnapshot = mock(async () => {});
    loadSettingsSnapshot.mockClear();

    const dispatchEvent = mock((_event: Event) => true);
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        dispatchEvent,
      },
    });

    try {
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
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      const dispatchedEvent = dispatchEvent.mock.calls[0]?.[0];
      expect(dispatchedEvent).toBeInstanceOf(CustomEvent);
      expect((dispatchedEvent as Event).type).toBe(SETTINGS_SNAPSHOT_UPDATED_EVENT);
      expect((dispatchedEvent as Event).type).not.toBe(REPO_SETTINGS_UPDATED_EVENT);

      await harness.unmount();
    } finally {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      } else {
        delete (globalThis as typeof globalThis & { window?: unknown }).window;
      }
    }
  });
});
