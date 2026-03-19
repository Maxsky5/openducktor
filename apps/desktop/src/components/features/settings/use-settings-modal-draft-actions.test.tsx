import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { useState } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";

enableReactActEnvironment();

type HarnessArgs = {
  selectedRepoPath: string | null;
  initialSnapshot: SettingsSnapshot;
};

const createInitialSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  globalPromptOverrides: {},
  repos: {
    "/repo-a": {
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/a",
      branchPrefix: "obp",
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
});

const useDraftActionsHarness = ({ selectedRepoPath, initialSnapshot }: HarnessArgs) => {
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(initialSnapshot);
  const actions = useSettingsModalDraftActions({
    selectedRepoPath,
    setSnapshotDraft,
  });
  return {
    snapshotDraft,
    ...actions,
  };
};

const createHookHarness = (initialProps: HarnessArgs) =>
  createSharedHookHarness(useDraftActionsHarness, initialProps);

describe("useSettingsModalDraftActions", () => {
  test("updates selected repo config and prompt overrides", async () => {
    const harness = createHookHarness({
      selectedRepoPath: "/repo-a",
      initialSnapshot: createInitialSnapshot(),
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateSelectedRepoConfig((repo) => ({
        ...repo,
        branchPrefix: "feature/",
      }));
      state.updateRepoPromptOverrides((overrides) => ({
        ...overrides,
        "kickoff.spec_initial": {
          template: "custom",
          baseVersion: 2,
          enabled: true,
        },
      }));
      state.updateGlobalPromptOverrides((overrides) => ({
        ...overrides,
        "system.role.spec.base": {
          template: "global custom",
          baseVersion: 2,
          enabled: true,
        },
      }));
    });

    const snapshot = harness.getLatest().snapshotDraft;
    expect(snapshot?.repos["/repo-a"]?.branchPrefix).toBe("feature/");
    expect(snapshot?.repos["/repo-a"]?.promptOverrides["kickoff.spec_initial"]?.template).toBe(
      "custom",
    );
    expect(snapshot?.globalPromptOverrides["system.role.spec.base"]?.template).toBe(
      "global custom",
    );

    await harness.unmount();
  });

  test("updates global chat settings without touching unrelated sections", async () => {
    const harness = createHookHarness({
      selectedRepoPath: "/repo-a",
      initialSnapshot: createInitialSnapshot(),
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateGlobalChatSettings((chat) => ({
        ...chat,
        showThinkingMessages: true,
      }));
    });

    const snapshot = harness.getLatest().snapshotDraft;
    expect(snapshot?.chat.showThinkingMessages).toBe(true);
    expect(snapshot?.git.defaultMergeMethod).toBe("merge_commit");
    expect(snapshot?.repos["/repo-a"]?.branchPrefix).toBe("obp");

    await harness.unmount();
  });

  test("updates and clears selected role agent defaults", async () => {
    const harness = createHookHarness({
      selectedRepoPath: "/repo-a",
      initialSnapshot: createInitialSnapshot(),
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateSelectedRepoAgentDefault("build", "providerId", "openai");
      state.updateSelectedRepoAgentDefault("build", "modelId", "gpt-5");
      state.updateSelectedRepoAgentDefault("build", "profileId", "builder");
      state.clearSelectedRepoAgentDefault("build");
    });

    const buildDefault = harness.getLatest().snapshotDraft?.repos["/repo-a"]?.agentDefaults.build;
    expect(buildDefault).toBeUndefined();

    await harness.unmount();
  });
});
