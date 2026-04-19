import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { EMPTY_PROMPT_VALIDATION_STATE } from "./settings-modal-controller.types";
import { type DirtySections, EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";
import { useSettingsModalSaveOrchestration } from "./use-settings-modal-save-orchestration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalSaveOrchestration>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalSaveOrchestration, initialProps);

const createSnapshot = (): SettingsSnapshot => ({
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
  autopilot: {
    rules: [],
  },
  globalPromptOverrides: {},
  workspaces: {
    repo: {
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
});

const createArgs = (
  overrides: Partial<HookArgs> = {},
  dirtySections: DirtySections = EMPTY_DIRTY_SECTIONS,
): HookArgs => ({
  open: true,
  loadedSnapshot: createSnapshot(),
  snapshotDraft: createSnapshot(),
  dirtySections,
  hasPromptValidationErrors: false,
  promptValidationState: EMPTY_PROMPT_VALIDATION_STATE,
  hasRepoScriptValidationErrors: false,
  repoScriptValidationErrorCount: 0,
  invalidRepoPathsWithDevServerErrors: [],
  selectedWorkspaceId: "repo",
  saveGlobalGitConfig: mock(async () => {}),
  saveSettingsSnapshot: mock(async () => {}),
  ...overrides,
});

describe("useSettingsModalSaveOrchestration", () => {
  test("returns false when no draft exists", async () => {
    const harness = createHookHarness(
      createArgs({
        snapshotDraft: null,
      }),
    );

    await harness.mount();

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);

    await harness.unmount();
  });

  test("blocks prompt validation errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs({
        hasPromptValidationErrors: true,
        promptValidationState: {
          ...EMPTY_PROMPT_VALIDATION_STATE,
          totalErrorCount: 2,
        },
        saveSettingsSnapshot,
      }),
    );

    await harness.mount();

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().saveError).toBe("Fix 2 prompt placeholder errors before saving.");
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("blocks repo script validation errors, shows submit-gated errors, and resets the gate when validation clears", async () => {
    const harness = createHookHarness(
      createArgs({
        hasRepoScriptValidationErrors: true,
        repoScriptValidationErrorCount: 1,
        invalidRepoPathsWithDevServerErrors: ["repo"],
      }),
    );

    await harness.mount();

    expect(harness.getLatest().showRepoScriptValidationErrors).toBe(false);

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().showRepoScriptValidationErrors).toBe(true);
    expect(harness.getLatest().saveError).toBe(
      "Fix 1 dev server field error in the selected repository before saving.",
    );

    await harness.update(
      createArgs(
        {
          hasRepoScriptValidationErrors: false,
          repoScriptValidationErrorCount: 0,
          invalidRepoPathsWithDevServerErrors: [],
        },
        EMPTY_DIRTY_SECTIONS,
      ),
    );

    expect(harness.getLatest().showRepoScriptValidationErrors).toBe(false);

    await harness.unmount();
  });

  test("returns true without persistence when nothing is dirty", async () => {
    const saveGlobalGitConfig = mock(async () => {});
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs({
        saveGlobalGitConfig,
        saveSettingsSnapshot,
      }),
    );

    await harness.mount();

    let didSave = false;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(saveGlobalGitConfig).toHaveBeenCalledTimes(0);
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("short-circuits unchanged global git saves and uses the optimized git path when needed", async () => {
    const unchangedSaveGlobalGitConfig = mock(async () => {});
    const unchangedHarness = createHookHarness(
      createArgs(
        {
          saveGlobalGitConfig: unchangedSaveGlobalGitConfig,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          globalGit: true,
        },
      ),
    );

    await unchangedHarness.mount();

    let didSave = false;
    await unchangedHarness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(unchangedSaveGlobalGitConfig).toHaveBeenCalledTimes(0);

    await unchangedHarness.unmount();

    const saveGlobalGitConfig = mock(async () => {});
    const changedSnapshot = createSnapshot();
    changedSnapshot.git.defaultMergeMethod = "squash";
    const changedHarness = createHookHarness(
      createArgs(
        {
          snapshotDraft: changedSnapshot,
          saveGlobalGitConfig,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          globalGit: true,
        },
      ),
    );

    await changedHarness.mount();

    await changedHarness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(saveGlobalGitConfig).toHaveBeenCalledWith({
      defaultMergeMethod: "squash",
    });

    await changedHarness.unmount();
  });

  test("saves the normalized snapshot when non-git sections are dirty", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const snapshotDraft = createSnapshot();
    snapshotDraft.chat.showThinkingMessages = true;
    const harness = createHookHarness(
      createArgs(
        {
          snapshotDraft,
          saveSettingsSnapshot,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          chat: true,
        },
      ),
    );

    await harness.mount();

    let didSave = false;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(saveSettingsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: {
          showThinkingMessages: true,
        },
      }),
    );

    await harness.unmount();
  });

  test("surfaces normalization errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const snapshotDraft = createSnapshot();
    const repoConfig = snapshotDraft.workspaces.repo;
    if (!repoConfig) {
      throw new Error("Expected repo settings fixture");
    }
    repoConfig.defaultRuntimeKind = "   ";
    const harness = createHookHarness(
      createArgs(
        {
          snapshotDraft,
          saveSettingsSnapshot,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          repoSettings: true,
        },
      ),
    );

    await harness.mount();

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().saveError).toBe("Default runtime kind cannot be blank.");
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });
});
