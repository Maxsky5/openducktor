import { describe, expect, mock, test } from "bun:test";
import type {
  RuntimeLifecycleImpact,
  SettingsSnapshot,
  SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import type { SettingsSaveOutcome } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { startHostRuntimeEventsHarness } from "@/test-utils/host-runtime-events-harness";
import {
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { SettingsSaveValidation } from "./settings-modal-save-policy";
import { type DirtySections, EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";
import { useSettingsModalSaveOrchestration } from "./use-settings-modal-save-orchestration";
import {
  RUNTIME_IMPACT_CHANGED_NOTICE,
  type RuntimeImpactReviewState,
} from "@/components/features/runtimes/runtime-impact-review";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalSaveOrchestration>[0];

const createHookHarness = (
  initialProps: HookArgs,
  options?: Parameters<typeof createSharedHookHarness>[2],
) => createSharedHookHarness(useSettingsModalSaveOrchestration, initialProps, options);

const createSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    workspaces: {
      repo: {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {},
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
  openCodePermissions: [],
  azureDevOps: {
    hasErrors: false,
    errorCount: 0,
    invalidWorkspaceIds: [],
    selectedWorkspaceId: null,
  },
  prompt: { hasErrors: false, errorCount: 0 },
  customAgentRoles: { hasErrors: false, errorCount: 0 },
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
  previewSettingsSnapshotRuntime: mock(async () => ({ impact: null })),
  saveSettingsSnapshot: mock(async () => savedSettingsResult()),
  loadSettingsSnapshot: mock(async () => createSnapshot()),
  isAgentModelFavoritesMutationPending: false,
  isKanbanTaskCardViewMutationPending: false,
  isSidebarSessionGroupingMutationPending: false,
  wasKanbanTaskCardViewEdited: false,
  ...overrides,
});

const isReviewReady = (review: RuntimeImpactReviewState | null): boolean =>
  review !== null && review.impact !== null && !review.isLoadingImpact;

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
  test("saves the preferred tool through the settings snapshot", async () => {
    const system = { preferredOpenInToolId: "zed" as const };
    const save = mock(async (_snapshot: Parameters<HookArgs["saveSettingsSnapshot"]>[0]) =>
      savedSettingsResult(),
    );
    const harness = createHookHarness(
      createArgs(
        {
          snapshotDraft: { ...createSnapshot(), system },
          saveSettingsSnapshot: save,
        },
        { ...EMPTY_DIRTY_SECTIONS, appearance: true },
      ),
    );
    try {
      await harness.mount();
      await harness.run(async (state) => {
        expect(await state.submit()).toBe(true);
      });
      expect(save.mock.calls[0]?.[0].system).toEqual(system);
    } finally {
      await harness.unmount();
    }
  });

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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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

  test("blocks a full snapshot save while the task card view is being written", async () => {
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const harness = createHookHarness(
      createArgs(
        {
          isKanbanTaskCardViewMutationPending: true,
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
      "Wait for the task card view update to finish before saving settings.",
    );
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);
    await harness.unmount();
  });

  test("blocks a full snapshot save while sidebar grouping is being written", async () => {
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const harness = createHookHarness(
      createArgs(
        { saveSettingsSnapshot, isSidebarSessionGroupingMutationPending: true },
        { ...EMPTY_DIRTY_SECTIONS, appearance: true },
      ),
    );
    try {
      await harness.mount();
      await harness.run(async (state) => expect(await state.submit()).toBe(false));
      expect(harness.getLatest().saveError).toBe(
        "Wait for the session grouping update to finish before saving settings.",
      );
      expect(saveSettingsSnapshot).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("saves an explicit grouping edit over a different saved shortcut value", async () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.appearance.sidebarSessionGrouping = "none";
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const harness = createHookHarness(
      createArgs(
        { snapshotDraft, saveSettingsSnapshot },
        { ...EMPTY_DIRTY_SECTIONS, appearance: true },
      ),
    );
    try {
      await harness.mount();
      await harness.run(async (state) => expect(await state.submit()).toBe(true));
      expect(saveSettingsSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          appearance: expect.objectContaining({ sidebarSessionGrouping: "none" }),
        }),
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("merges independently saved fields into a full snapshot save", async () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentModelFavorites = [
      { runtimeKind: "claude", providerId: "anthropic", modelId: "stale" },
    ];
    const latestSnapshot = createSnapshot();
    latestSnapshot.agentModelFavorites = [
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    ];
    latestSnapshot.kanban.taskCardView = "compact";
    latestSnapshot.appearance.sidebarSessionGrouping = "none";
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
        kanban: expect.objectContaining({ taskCardView: "compact" }),
        appearance: expect.objectContaining({ sidebarSessionGrouping: "none" }),
      }),
      undefined,
    );
    await harness.unmount();
  });

  test("keeps an explicit final task card view that matches the loaded value", async () => {
    const loadedSnapshot = createSnapshot();
    const snapshotDraft = createSnapshot();
    const latestSnapshot = createSnapshot();
    latestSnapshot.kanban.taskCardView = "compact";
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const harness = createHookHarness(
      createArgs(
        {
          loadedSnapshot,
          snapshotDraft,
          loadSettingsSnapshot: mock(async () => latestSnapshot),
          saveSettingsSnapshot,
          wasKanbanTaskCardViewEdited: true,
        },
        { ...EMPTY_DIRTY_SECTIONS, kanban: true },
      ),
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.submit();
    });

    expect(saveSettingsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        kanban: expect.objectContaining({ taskCardView: "normal" }),
      }),
      undefined,
    );
    await harness.unmount();
  });

  test("blocks runtime executable errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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

  test("blocks concurrent repository saves while the modal is busy", async () => {
    const deferredSave = createDeferred<void>();
    const saveSettingsSnapshot = mock(async () => {
      await deferredSave.promise;
      return savedSettingsResult();
    });
    const harness = createHookHarness(
      createArgs(
        {
          saveSettingsSnapshot,
        },
        {
          ...EMPTY_DIRTY_SECTIONS,
          repoSettings: true,
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
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
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
          sidebarSessionGrouping: "task",
        },
        general: {
          openAgentStudioTabOnBackgroundSessionStart: true,
        },
        reusablePrompts: [],
      }),
      undefined,
    );

    await harness.unmount();
  });

  test("surfaces save-preparation errors before persistence", async () => {
    const saveSettingsSnapshot = mock(async () => savedSettingsResult());
    const snapshotDraft = createSnapshot();
    snapshotDraft.reusablePrompts = [
      {
        id: "prompt-1",
        name: "",
        description: "",
        content: "",
      },
    ];
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
    expect(harness.getLatest().saveError).toBe("Reusable prompts contain invalid fields.");
    expect(saveSettingsSnapshot).toHaveBeenCalledTimes(0);

    await harness.unmount();
  });
});

describe("useSettingsModalSaveOrchestration runtime review", () => {
  const impactWith = (confirmation: string, sessions: number): RuntimeLifecycleImpact => ({
    kinds: [
      {
        kind: "opencode",
        runtimeId: "opencode-1",
        effect: "replace",
        oldExecutablePath: "/old/opencode",
        newExecutablePath: "/new/opencode",
      },
    ],
    workspaces:
      sessions === 0
        ? []
        : [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              sessions: Array.from({ length: sessions }, (_, index) => ({
                ref: {
                  repoPath: "/repo",
                  runtimeKind: "opencode" as const,
                  workingDirectory: "/repo",
                  externalSessionId: `session-${index}`,
                },
                title: `Session ${index}`,
                activity: "running" as const,
                pendingInputCount: 0,
              })),
            },
          ],
    confirmation,
  });
  const runtimeDraft = (): SettingsSnapshot => {
    const snapshot = createSnapshot();
    return {
      ...snapshot,
      agentRuntimes: {
        ...snapshot.agentRuntimes,
        opencode: {
          ...snapshot.agentRuntimes.opencode,
          enabled: true,
          executablePath: "/new/opencode",
        },
      },
    };
  };
  const runtimeArgs = (overrides: Partial<HookArgs>) =>
    createArgs(
      {
        loadedSnapshot: createSnapshot(),
        snapshotDraft: runtimeDraft(),
        loadSettingsSnapshot: mock(async () => createSnapshot()),
        ...overrides,
      },
      { ...EMPTY_DIRTY_SECTIONS, agentRuntimes: true },
    );

  test("asks for review before a save that stops live sessions", async () => {
    const save = mock(async (_snapshot: SettingsSnapshotSaveInput, _confirmation?: string) =>
      savedSettingsResult(),
    );
    const harness = createHookHarness(
      runtimeArgs({
        previewSettingsSnapshotRuntime: mock(async () => ({ impact: impactWith("token-1", 1) })),
        saveSettingsSnapshot: save,
      }),
    );
    try {
      await harness.mount();
      let submitted: Promise<boolean> = Promise.resolve(false);
      await harness.run((state) => {
        submitted = state.submit();
      });
      await harness.waitFor((state) => isReviewReady(state.runtimeReview));
      expect(save).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeReview?.notice).toBeNull();

      await harness.run((state) => state.confirmRuntimeReview());
      expect(await submitted).toBe(true);
      expect(save.mock.calls[0]?.[1]).toBe("token-1");
      await harness.waitFor((state) => state.runtimeReview === null);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps an open review current from live session events", async () => {
    let previewToken = "token-1";
    const preview = mock(async () => ({ impact: impactWith(previewToken, 1) }));
    const save = mock(async (_snapshot: SettingsSnapshotSaveInput, _confirmation?: string) =>
      savedSettingsResult(),
    );
    const events = startHostRuntimeEventsHarness();
    const harness = createHookHarness(
      runtimeArgs({ previewSettingsSnapshotRuntime: preview, saveSettingsSnapshot: save }),
      {
        hostRuntimeStatusContext: createHostRuntimeStatusContextValue({
          runtimeEvents: events.owner,
        }),
      },
    );
    try {
      await harness.mount();
      let submitted: Promise<boolean> = Promise.resolve(false);
      await harness.run((state) => {
        submitted = state.submit();
      });
      await harness.waitFor((state) => isReviewReady(state.runtimeReview));
      const readsBeforeChange = preview.mock.calls.length;

      previewToken = "token-2";
      await harness.run(() => {
        events.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });
      });
      await harness.waitFor(
        (state) =>
          isReviewReady(state.runtimeReview) &&
          state.runtimeReview?.impact?.confirmation === "token-2",
      );
      expect(preview.mock.calls.length).toBe(readsBeforeChange + 1);

      await harness.run((state) => state.confirmRuntimeReview());
      expect(await submitted).toBe(true);
      expect(save.mock.calls.map((call) => call[1])).toEqual(["token-2"]);
    } finally {
      await harness.unmount();
      events.owner.stop();
    }
  });

  test("cancel keeps the draft and writes nothing", async () => {
    const save = mock(async () => savedSettingsResult());
    const harness = createHookHarness(
      runtimeArgs({
        previewSettingsSnapshotRuntime: mock(async () => ({ impact: impactWith("token-1", 2) })),
        saveSettingsSnapshot: save,
      }),
    );
    try {
      await harness.mount();
      let submitted: Promise<boolean> = Promise.resolve(false);
      await harness.run((state) => {
        submitted = state.submit();
      });
      await harness.waitFor((state) => state.runtimeReview !== null);
      await harness.run((state) => state.cancelRuntimeReview());

      expect(await submitted).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(harness.getLatest().runtimeReview).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("a changed impact opens the review again with a notice", async () => {
    let calls = 0;
    const save = mock(
      async (
        _snapshot: SettingsSnapshotSaveInput,
        _confirmation?: string,
      ): Promise<SettingsSaveOutcome> => {
        calls += 1;
        return calls === 1
          ? { type: "runtime_impact_changed", impact: impactWith("token-2", 2) }
          : savedSettingsResult();
      },
    );
    const harness = createHookHarness(
      runtimeArgs({
        previewSettingsSnapshotRuntime: mock(async () => ({ impact: impactWith("token-1", 1) })),
        saveSettingsSnapshot: save,
      }),
    );
    try {
      await harness.mount();
      let submitted: Promise<boolean> = Promise.resolve(false);
      await harness.run((state) => {
        submitted = state.submit();
      });
      await harness.waitFor((state) => isReviewReady(state.runtimeReview));
      await harness.run((state) => state.confirmRuntimeReview());
      await harness.waitFor(
        (state) => state.runtimeReview?.notice === RUNTIME_IMPACT_CHANGED_NOTICE,
      );
      expect(harness.getLatest().runtimeReview?.impact?.confirmation).toBe("token-2");

      await harness.run((state) => state.confirmRuntimeReview());
      expect(await submitted).toBe(true);
      expect(save.mock.calls.map((call) => call[1])).toEqual(["token-1", "token-2"]);
    } finally {
      await harness.unmount();
    }
  });

  test("saves directly with the confirmation when no live session is affected", async () => {
    const save = mock(async (_snapshot: SettingsSnapshotSaveInput, _confirmation?: string) =>
      savedSettingsResult(),
    );
    const harness = createHookHarness(
      runtimeArgs({
        previewSettingsSnapshotRuntime: mock(async () => ({ impact: impactWith("token-1", 0) })),
        saveSettingsSnapshot: save,
      }),
    );
    try {
      await harness.mount();
      await harness.run(async (state) => {
        expect(await state.submit()).toBe(true);
      });
      expect(save.mock.calls[0]?.[1]).toBe("token-1");
      expect(harness.getLatest().runtimeReview).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("skips the preview when no runtime lifecycle setting changed", async () => {
    const preview = mock(async () => ({ impact: null }));
    const harness = createHookHarness(
      createArgs(
        { previewSettingsSnapshotRuntime: preview },
        { ...EMPTY_DIRTY_SECTIONS, appearance: true },
      ),
    );
    try {
      await harness.mount();
      await harness.run(async (state) => {
        expect(await state.submit()).toBe(true);
      });
      expect(preview).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
