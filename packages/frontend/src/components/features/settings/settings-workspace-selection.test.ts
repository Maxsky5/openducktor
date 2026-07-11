import { describe, expect, test } from "bun:test";
import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { chooseInitialSettingsWorkspaceId } from "./settings-workspace-selection";

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  ",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const createSnapshot = (workspaces: SettingsSnapshot["workspaces"]): SettingsSnapshot =>
  createSettingsSnapshotFixture({ workspaces });

describe("settings workspace selection", () => {
  test("selects initial repo using active repo when available", () => {
    const snapshot = createSnapshot({
      "repo-b": createRepoConfig({
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
      }),
      "repo-a": createRepoConfig(),
    });

    expect(
      chooseInitialSettingsWorkspaceId(snapshot, { kind: "preferred", repoPath: "/repo-b" }),
    ).toBe("repo-b");
    expect(
      chooseInitialSettingsWorkspaceId(snapshot, { kind: "preferred", repoPath: "/missing" }),
    ).toBe("repo-a");
    expect(
      chooseInitialSettingsWorkspaceId(createSnapshot({}), {
        kind: "preferred",
        repoPath: null,
      }),
    ).toBeNull();
  });

  test("requires an exact repository match for explicit settings navigation", () => {
    const snapshot = createSnapshot({
      "repo-b": createRepoConfig({
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
      }),
      "repo-a": createRepoConfig(),
    });

    expect(
      chooseInitialSettingsWorkspaceId(snapshot, { kind: "required", repoPath: "/repo-b" }),
    ).toBe("repo-b");
    expect(
      chooseInitialSettingsWorkspaceId(snapshot, { kind: "required", repoPath: "/missing" }),
    ).toBeNull();
    expect(
      chooseInitialSettingsWorkspaceId(snapshot, { kind: "required", repoPath: null }),
    ).toBeNull();
  });
});
