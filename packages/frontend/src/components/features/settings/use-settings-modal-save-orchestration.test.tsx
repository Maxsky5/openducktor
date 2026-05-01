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
    emptyColumnDisplay: "show",
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
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeCopyPaths: [],
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

const createDeferred = <TValue,>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  const promise = new Promise<TValue>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    promise,
    resolve,
  };
};

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

  test("rejects concurrent submit attempts while a save is already in flight", async () => {
    const deferredSave = createDeferred<void>();
    const saveSettingsSnapshot = mock(async () => {
      await deferredSave.promise;
    });
    const harness = createHookHarness(
      createArgs(
        {
          saveSettingsSnapshot,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          chat: true,
        },
      ),
    );

    await harness.mount();

    let firstSubmit: Promise<boolean> | undefined;
    let secondResult = true;
    await harness.run(async (state) => {
      firstSubmit = state.submit();
      secondResult = await state.submit();
    });

    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(secondResult).toBe(false);
    expect(harness.getLatest().isSaving).toBe(true);

    deferredSave.resolve();
    if (!firstSubmit) {
      throw new Error("Expected first submit promise");
    }
    await harness.run(async () => {
      deferredSave.resolve();
      await firstSubmit;
    });
    const firstResult = await firstSubmit;
    await harness.waitFor((state) => !state.isSaving);

    expect(firstResult).toBe(true);
    expect(harness.getLatest().isSaving).toBe(false);

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
    repoConfig.agentDefaults.spec = {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    } as unknown as NonNullable<typeof repoConfig.agentDefaults.spec>;
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
    expect(harness.getLatest().saveError).toBe(
      "Specification agent default runtime kind is required when provider and model are configured.",
    );
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });
});
