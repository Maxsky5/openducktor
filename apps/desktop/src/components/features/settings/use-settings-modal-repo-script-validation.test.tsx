import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalRepoScriptValidation } from "./use-settings-modal-repo-script-validation";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalRepoScriptValidation>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalRepoScriptValidation, initialProps);

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
    "repo-a": {
      workspaceId: "repo-a",
      workspaceName: "Repo A",
      repoPath: "/repo-a",
      defaultRuntimeKind: "opencode",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      devServers: [{ id: "frontend", name: "Frontend", command: "" }],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
    "repo-b": {
      workspaceId: "repo-b",
      workspaceName: "Repo B",
      repoPath: "/repo-b",
      defaultRuntimeKind: "opencode",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      devServers: [{ id: "backend", name: "", command: "" }],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
});

describe("useSettingsModalRepoScriptValidation", () => {
  test("returns selected repo errors and aggregate error counts across repositories", async () => {
    const snapshotDraft = createSnapshot();
    const harness = createHookHarness({
      snapshotDraft,
      selectedRepoConfig: snapshotDraft.workspaces["repo-a"] ?? null,
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.selectedRepoDevServerValidationErrors).toEqual({
      frontend: {
        command: "Command is required.",
      },
    });
    expect(latest.invalidRepoPathsWithDevServerErrors).toEqual(["repo-a", "repo-b"]);
    expect(latest.repoScriptValidationErrorCount).toBe(3);
    expect(latest.hasRepoScriptValidationErrors).toBe(true);

    await harness.unmount();
  });

  test("returns an empty validation state when the draft is missing", async () => {
    const harness = createHookHarness({
      snapshotDraft: null,
      selectedRepoConfig: null,
    });

    await harness.mount();

    expect(harness.getLatest()).toEqual({
      selectedRepoDevServerValidationErrors: {},
      invalidRepoPathsWithDevServerErrors: [],
      repoScriptValidationErrorCount: 0,
      hasRepoScriptValidationErrors: false,
    });

    await harness.unmount();
  });
});
