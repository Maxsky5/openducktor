import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useSettingsModalRepoScriptValidation } from "./use-settings-modal-repo-script-validation";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalRepoScriptValidation>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalRepoScriptValidation, initialProps);

const createSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    workspaces: {
      "repo-a": {
        workspaceId: "repo-a",
        workspaceName: "Repo A",
        repoPath: "/repo-a",
        defaultRuntimeKind: "opencode",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        hooks: { preStart: [], postComplete: [] },
        devServers: [{ id: "frontend", name: "", command: "bun run dev" }],
        worktreeCopyPaths: [],
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
        hooks: { preStart: [], postComplete: [] },
        devServers: [{ id: "backend", name: "", command: "bun run api" }],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      },
      "repo-c": {
        workspaceId: "repo-c",
        workspaceName: "Repo C",
        repoPath: "/repo-c",
        defaultRuntimeKind: "opencode",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        hooks: { preStart: [], postComplete: [] },
        devServers: [{ id: "", name: "", command: "   " }],
        worktreeCopyPaths: [],
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
        name: "Tab label is required.",
      },
    });
    expect(latest.invalidRepoPathsWithDevServerErrors).toEqual(["repo-a", "repo-b"]);
    expect(latest.repoScriptValidationErrorCountByWorkspaceId).toEqual({
      "repo-a": 1,
      "repo-b": 1,
    });
    expect(latest.repoScriptValidationErrorCount).toBe(2);
    expect(latest.hasRepoScriptValidationErrors).toBe(true);

    await harness.unmount();
  });

  test("ignores empty-command dev server drafts", async () => {
    const snapshotDraft = createSnapshot();
    const harness = createHookHarness({
      snapshotDraft,
      selectedRepoConfig: snapshotDraft.workspaces["repo-c"] ?? null,
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.selectedRepoDevServerValidationErrors).toEqual({});
    expect(latest.invalidRepoPathsWithDevServerErrors).toEqual(["repo-a", "repo-b"]);
    expect(latest.repoScriptValidationErrorCountByWorkspaceId).toEqual({
      "repo-a": 1,
      "repo-b": 1,
    });
    expect(latest.repoScriptValidationErrorCount).toBe(2);
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
      repoScriptValidationErrorCountByWorkspaceId: {},
      repoScriptValidationErrorCount: 0,
      hasRepoScriptValidationErrors: false,
    });

    await harness.unmount();
  });
});
