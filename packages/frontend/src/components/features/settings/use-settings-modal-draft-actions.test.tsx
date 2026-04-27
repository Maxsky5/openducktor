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
  selectedWorkspaceId: string | null;
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
  kanban: {
    doneVisibleDays: 1,
  },
  autopilot: {
    rules: [],
  },
  globalPromptOverrides: {},
  workspaces: {
    "repo-a": {
      workspaceId: "repo-a",
      workspaceName: "Repo A",
      repoPath: "/repo-a",
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/a",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
});

const useDraftActionsHarness = ({ selectedWorkspaceId, initialSnapshot }: HarnessArgs) => {
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(initialSnapshot);
  const actions = useSettingsModalDraftActions({
    selectedWorkspaceId,
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
      selectedWorkspaceId: "repo-a",
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
    expect(snapshot?.workspaces["repo-a"]?.branchPrefix).toBe("feature/");
    expect(snapshot?.workspaces["repo-a"]?.promptOverrides["kickoff.spec_initial"]?.template).toBe(
      "custom",
    );
    expect(snapshot?.globalPromptOverrides["system.role.spec.base"]?.template).toBe(
      "global custom",
    );

    await harness.unmount();
  });

  test("updates global chat settings without touching unrelated sections", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: "repo-a",
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
    expect(snapshot?.workspaces["repo-a"]?.branchPrefix).toBe("obp");

    await harness.unmount();
  });

  test("updates global kanban settings without touching unrelated sections", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: "repo-a",
      initialSnapshot: createInitialSnapshot(),
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateGlobalKanbanSettings((kanban) => ({
        ...kanban,
        doneVisibleDays: 7,
      }));
    });

    const snapshot = harness.getLatest().snapshotDraft;
    expect(snapshot?.kanban.doneVisibleDays).toBe(7);
    expect(snapshot?.chat.showThinkingMessages).toBe(false);

    await harness.unmount();
  });

  test("updates and clears selected role agent defaults", async () => {
    const harness = createHookHarness({
      selectedWorkspaceId: "repo-a",
      initialSnapshot: createInitialSnapshot(),
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateSelectedRepoAgentDefault("build", "providerId", "openai");
      state.updateSelectedRepoAgentDefault("build", "modelId", "gpt-5");
      state.updateSelectedRepoAgentDefault("build", "profileId", "builder");
      state.clearSelectedRepoAgentDefault("build");
    });

    const buildDefault =
      harness.getLatest().snapshotDraft?.workspaces["repo-a"]?.agentDefaults.build;
    expect(buildDefault).toBeUndefined();

    await harness.unmount();
  });

  test("preserves the inherited repo default runtime when editing role fields", async () => {
    const initialSnapshot = createInitialSnapshot();
    const selectedRepo = initialSnapshot.workspaces["repo-a"];
    if (!selectedRepo) {
      throw new Error("Expected repo-a snapshot fixture");
    }

    initialSnapshot.workspaces["repo-a"] = {
      ...selectedRepo,
      defaultRuntimeKind: "codex",
    };

    const harness = createHookHarness({
      selectedWorkspaceId: "repo-a",
      initialSnapshot,
    });
    await harness.mount();

    await harness.run((state) => {
      state.updateSelectedRepoAgentDefault("planner", "profileId", "planner-agent");
    });

    expect(harness.getLatest().snapshotDraft?.workspaces["repo-a"]?.agentDefaults.planner).toEqual({
      runtimeKind: "codex",
      providerId: "",
      modelId: "",
      variant: "",
      profileId: "planner-agent",
    });

    await harness.unmount();
  });
});
