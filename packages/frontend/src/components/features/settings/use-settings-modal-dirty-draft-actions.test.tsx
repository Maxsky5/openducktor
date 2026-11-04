import { builtinWorkflowPromptKey } from "@openducktor/workflows/test-support";
import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { useState } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useSettingsModalDirtyDraftActions } from "./use-settings-modal-dirty-draft-actions";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";

enableReactActEnvironment();

type HookArgs = {
  selectedWorkspaceId: string | null;
  initialSnapshot: SettingsSnapshot;
};

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
        hooks: { postComplete: [] },
        actions: { items: [], defaultActionId: null },
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      },
    },
  });

const useDirtyDraftActionsHarness = ({ selectedWorkspaceId, initialSnapshot }: HookArgs) => {
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(initialSnapshot);
  const [clearSaveError] = useState(() => mock(() => {}));
  const draftActions = useSettingsModalDraftActions({
    selectedWorkspaceId,
    setSnapshotDraft,
  });
  const actions = useSettingsModalDirtyDraftActions({
    clearSaveError,
    draftActions,
  });

  return {
    snapshotDraft,
    clearSaveError,
    ...actions,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useDirtyDraftActionsHarness, initialProps);

describe("useSettingsModalDirtyDraftActions", () => {
  test("updates the preferred tool draft", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: null,
      initialSnapshot: createSnapshot(),
    });
    await harness.mount();
    await harness.run((state) =>
      state.updateGlobalSystemSettings(() => ({ preferredOpenInToolId: "zed" })),
    );
    expect(harness.getLatest().snapshotDraft?.system).toEqual({ preferredOpenInToolId: "zed" });
    await harness.unmount();
  });

  test("clears save errors before updating draft state", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: "repo",
      initialSnapshot: createSnapshot(),
    });

    await harness.mount();

    await harness.run((state) => {
      state.updateGlobalChatSettings((chat) => ({
        ...chat,
        showThinkingMessages: true,
      }));
      state.updateGlobalGeneralSettings((general) => ({
        ...general,
        openAgentStudioTabOnBackgroundSessionStart: false,
      }));
      state.updateGlobalAppearanceSettings((appearance) => ({
        ...appearance,
        horizontalScrollbarVisibility: "hide",
      }));
      state.updateGlobalAutopilotSettings((autopilot) => ({
        ...autopilot,
        alwaysStartQaReviewsFresh: true,
      }));
      state.updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        branchPrefix: "feature/",
      }));
    });

    expect(harness.getLatest().clearSaveError).toHaveBeenCalledTimes(5);
    expect(harness.getLatest().snapshotDraft?.chat.showThinkingMessages).toBe(true);
    expect(
      harness.getLatest().snapshotDraft?.general.openAgentStudioTabOnBackgroundSessionStart,
    ).toBe(false);
    expect(harness.getLatest().snapshotDraft?.appearance.horizontalScrollbarVisibility).toBe(
      "hide",
    );
    expect(harness.getLatest().snapshotDraft?.autopilot.alwaysStartQaReviewsFresh).toBe(true);
    expect(harness.getLatest().snapshotDraft?.workspaces.repo?.branchPrefix).toBe("feature/");

    await harness.unmount();
  });

  test("routes repo prompt override and agent default edits through repo settings dirty tracking", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: "repo",
      initialSnapshot: createSnapshot(),
    });

    await harness.mount();

    await harness.run((state) => {
      state.updateRepoPromptOverrides((overrides) => ({
        ...overrides,
        [builtinWorkflowPromptKey("messages.spec_start")]: {
          template: "custom",
          baseVersion: 1,
          enabled: true,
        },
      }));
      state.updateSelectedRepoAgentDefault("build", "profileId", "builder");
    });

    expect(
      harness.getLatest().snapshotDraft?.workspaces.repo?.promptOverrides[
        builtinWorkflowPromptKey("messages.spec_start")
      ]?.template,
    ).toBe("custom");
    expect(harness.getLatest().snapshotDraft?.workspaces.repo?.agentDefaults.build?.profileId).toBe(
      "builder",
    );

    await harness.unmount();
  });
});
