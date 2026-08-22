import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { SettingsSaveValidation } from "./settings-modal-save-policy";
import { type DirtySections, EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";
import { useSettingsModalSaveOrchestration } from "./use-settings-modal-save-orchestration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalSaveOrchestration>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalSaveOrchestration, initialProps);

const createSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
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

const createValidation = (
  overrides: Partial<SettingsSaveValidation> = {},
): SettingsSaveValidation => ({
  prompt: { hasErrors: false, errorCount: 0 },
  reusablePrompts: { hasErrors: false, errorCount: 0 },
  runtimeRequest: { isPending: false, error: null },
  runtimeAvailability: { hasErrors: false, errorCount: 0, invalidKind: null },
  hasUnacknowledgedCodexDangerousSettings: false,
  repoScripts: {
    hasErrors: false,
    errorCount: 0,
    invalidRepoPaths: [],
    selectedWorkspaceId: "repo",
  },
  ...overrides,
});

const createArgs = (
  overrides: Partial<HookArgs> = {},
  dirtySections: DirtySections = EMPTY_DIRTY_SECTIONS,
): HookArgs => ({
  open: true,
  loadedSnapshot: createSnapshot(),
  snapshotDraft: createSnapshot(),
  dirtySections,
  validation: createValidation(),
  onRuntimeAvailabilityError: () => {},
  saveGlobalGitConfig: mock(async () => {}),
  saveSettingsSnapshot: mock(async () => {}),
  loadSettingsSnapshot: mock(async () => createSnapshot()),
  isAgentModelFavoritesMutationPending: false,
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
        validation: createValidation({ prompt: { hasErrors: true, errorCount: 2 } }),
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

  test("blocks a full snapshot save while favorites are being written", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs(
        {
          isAgentModelFavoritesMutationPending: true,
          saveSettingsSnapshot,
        },
        { ...EMPTY_DIRTY_SECTIONS, chat: true },
      ),
    );

    await harness.mount();
    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().saveError).toBe(
      "Wait for the model favorites update to finish before saving settings.",
    );
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    await harness.unmount();
  });

  test("merges the latest persisted favorites into a full snapshot save", async () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentModelFavorites = [
      { runtimeKind: "claude", providerId: "anthropic", modelId: "stale" },
    ];
    const latestSnapshot = createSnapshot();
    latestSnapshot.agentModelFavorites = [
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    ];
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs(
        {
          snapshotDraft,
          loadSettingsSnapshot: mock(async () => latestSnapshot),
          saveSettingsSnapshot,
        },
        { ...EMPTY_DIRTY_SECTIONS, chat: true },
      ),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.submit();
    });

    expect(saveSettingsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        agentModelFavorites: latestSnapshot.agentModelFavorites,
      }),
    );
    await harness.unmount();
  });

  test("blocks runtime executable errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs({
        validation: createValidation({
          runtimeAvailability: { hasErrors: true, errorCount: 2, invalidKind: null },
        }),
        saveSettingsSnapshot,
      }),
    );

    await harness.mount();

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().saveError).toBe("Fix 2 runtime executable errors before saving.");
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("requests focus for the first invalid runtime when save is blocked", async () => {
    const onRuntimeAvailabilityError = mock(() => {});
    const harness = createHookHarness(
      createArgs({
        validation: createValidation({
          runtimeAvailability: { hasErrors: true, errorCount: 1, invalidKind: "codex" },
        }),
        onRuntimeAvailabilityError,
      }),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.submit();
    });

    expect(onRuntimeAvailabilityError).toHaveBeenCalledTimes(1);
    expect(onRuntimeAvailabilityError).toHaveBeenCalledWith("codex");

    await harness.unmount();
  });

  test("blocks unacknowledged dangerous Codex settings before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const harness = createHookHarness(
      createArgs({
        validation: createValidation({ hasUnacknowledgedCodexDangerousSettings: true }),
        saveSettingsSnapshot,
      }),
    );

    await harness.mount();

    let didSave = true;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(false);
    expect(harness.getLatest().saveError).toBe(
      "Confirm the Codex safety acknowledgement before saving.",
    );
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });

  test("saves dangerous effective Codex read-only role settings after acknowledgement", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentRuntimes.codex = {
      ...snapshotDraft.agentRuntimes.codex,
      defaults: {
        ...snapshotDraft.agentRuntimes.codex.defaults,
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
      },
    };
    const harness = createHookHarness(
      createArgs(
        {
          snapshotDraft,
          saveSettingsSnapshot,
        },
        { ...EMPTY_DIRTY_SECTIONS, agentRuntimes: true },
      ),
    );

    await harness.mount();

    let didSave = false;
    await harness.run(async (state) => {
      didSave = await state.submit();
    });

    expect(didSave).toBe(true);
    expect(harness.getLatest().saveError).toBeNull();
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });

  test("blocks repo script validation errors, shows submit-gated errors, and resets the gate when validation clears", async () => {
    const harness = createHookHarness(
      createArgs({
        validation: createValidation({
          repoScripts: {
            hasErrors: true,
            errorCount: 1,
            invalidRepoPaths: ["repo"],
            selectedWorkspaceId: "repo",
          },
        }),
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
          validation: createValidation(),
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

  test("saves the prepared snapshot when non-git sections are dirty", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const snapshotDraft = createSnapshot();
    snapshotDraft.chat.showThinkingMessages = true;
    snapshotDraft.appearance.horizontalScrollbarVisibility = "show";
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
    const expectedChatSettings = {
      ...createSnapshot().chat,
      showThinkingMessages: true,
    };
    expect(saveSettingsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expectedChatSettings,
        appearance: {
          horizontalScrollbarVisibility: "show",
        },
        general: {
          openAgentStudioTabOnBackgroundSessionStart: true,
        },
        reusablePrompts: [],
      }),
    );

    await harness.unmount();
  });

  test("surfaces save-preparation errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => {});
    const snapshotDraft = createSnapshot();
    const repoConfig = snapshotDraft.workspaces.repo;
    if (!repoConfig) {
      throw new Error("Expected repo settings fixture");
    }
    // SAFETY: This test controls the fixture and supplies `NonNullable<typeof repoConfig.agentDefaults.spec>` used by this case.
    repoConfig.agentDefaults.spec = {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    } as NonNullable<typeof repoConfig.agentDefaults.spec>;
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
