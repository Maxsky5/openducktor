import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { useState } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalDirtyDraftActions } from "./use-settings-modal-dirty-draft-actions";
import type { DirtySections } from "./use-settings-modal-dirty-state";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";

enableReactActEnvironment();

type HookArgs = {
  selectedWorkspaceId: string | null;
  initialSnapshot: SettingsSnapshot;
};

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
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
});

const useDirtyDraftActionsHarness = ({ selectedWorkspaceId, initialSnapshot }: HookArgs) => {
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(initialSnapshot);
  const [dirtyCalls, setDirtyCalls] = useState<(keyof DirtySections)[]>([]);
  const [clearSaveError] = useState(() => mock(() => {}));
  const draftActions = useSettingsModalDraftActions({
    selectedWorkspaceId,
    setSnapshotDraft,
  });
  const actions = useSettingsModalDirtyDraftActions({
    clearSaveError,
    markDirty: (section) => {
      setDirtyCalls((current) => [...current, section]);
    },
    draftActions,
  });

  return {
    snapshotDraft,
    dirtyCalls,
    clearSaveError,
    ...actions,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useDirtyDraftActionsHarness, initialProps);

describe("useSettingsModalDirtyDraftActions", () => {
  test("clears save errors and marks the matching section before updating draft state", async () => {
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
      state.updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        branchPrefix: "feature/",
      }));
    });

    expect(harness.getLatest().clearSaveError).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().dirtyCalls).toEqual(["chat", "repoSettings"]);
    expect(harness.getLatest().snapshotDraft?.chat.showThinkingMessages).toBe(true);
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
        "kickoff.spec_initial": {
          template: "custom",
          baseVersion: 1,
          enabled: true,
        },
      }));
      state.updateSelectedRepoAgentDefault("build", "profileId", "builder");
    });

    expect(harness.getLatest().dirtyCalls).toEqual(["repoSettings", "repoSettings"]);
    expect(
      harness.getLatest().snapshotDraft?.workspaces.repo?.promptOverrides["kickoff.spec_initial"]
        ?.template,
    ).toBe("custom");
    expect(harness.getLatest().snapshotDraft?.workspaces.repo?.agentDefaults.build?.profileId).toBe(
      "builder",
    );

    await harness.unmount();
  });
});
