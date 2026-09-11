import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  type RepoGitConfig,
  type SettingsRepoConfig,
  settingsRepoConfigSchema,
} from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { diffSettingsSnapshots } from "./settings-snapshot-changes";

const githubProvider = (name: string): NonNullable<RepoGitConfig["provider"]> => ({
  id: "github",
  enabled: true,
  repository: { host: "github.com", owner: "Maxsky5", name },
  autoDetected: false,
});

const createRepoConfig = (
  workspaceId: string,
  repoPath: string,
  provider?: RepoGitConfig["provider"],
): SettingsRepoConfig =>
  settingsRepoConfigSchema.parse({
    workspaceId,
    workspaceName: workspaceId,
    repoPath,
    defaultRuntimeKind: "opencode",
    git: provider === undefined ? {} : { provider },
  });

const createSnapshot = (
  workspaces: Record<string, SettingsRepoConfig>,
  overrides: Parameters<typeof createSettingsSnapshotFixture>[0] = {},
) => createSettingsSnapshotFixture({ workspaces, ...overrides });

describe("diffSettingsSnapshots", () => {
  test("reports every repository when the previous snapshot is missing", () => {
    const changes = diffSettingsSnapshots(
      undefined,
      createSnapshot({
        "repo-a": createRepoConfig("repo-a", "/repo-a"),
        "repo-b": createRepoConfig("repo-b", "/repo-b"),
      }),
    );

    expect(changes).toEqual({
      workspacesChanged: true,
      agentRuntimesChanged: true,
      kanbanDoneVisibleDaysChanged: false,
      changedGitProviderRepoPaths: ["/repo-a", "/repo-b"],
    });
  });

  test("reports no changes for identical snapshots", () => {
    const workspaces = {
      "repo-a": createRepoConfig("repo-a", "/repo-a"),
      "repo-b": createRepoConfig("repo-b", "/repo-b", githubProvider("repo-b")),
    };

    expect(diffSettingsSnapshots(createSnapshot(workspaces), createSnapshot(workspaces))).toEqual({
      workspacesChanged: false,
      agentRuntimesChanged: false,
      kanbanDoneVisibleDaysChanged: false,
      changedGitProviderRepoPaths: [],
    });
  });

  test("reports only the repository whose git provider config changed", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({
        "repo-a": createRepoConfig("repo-a", "/repo-a"),
        "repo-b": createRepoConfig("repo-b", "/repo-b", githubProvider("repo-b")),
      }),
      createSnapshot({
        "repo-a": createRepoConfig("repo-a", "/repo-a"),
        "repo-b": createRepoConfig("repo-b", "/repo-b", githubProvider("renamed")),
      }),
    );

    expect(changes.workspacesChanged).toBe(true);
    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-b"]);
  });

  test("reports the new path when a repository path changes", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({ "repo-a": createRepoConfig("repo-a", "/repo-a") }),
      createSnapshot({ "repo-a": createRepoConfig("repo-a", "/repo-moved") }),
    );

    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-moved"]);
  });

  test("reports a repository added after the previous snapshot", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({}),
      createSnapshot({ "repo-a": createRepoConfig("repo-a", "/repo-a") }),
    );

    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-a"]);
  });

  test("reports changed agent runtimes and kanban retention", () => {
    const nextRuntimes = structuredClone(DEFAULT_AGENT_RUNTIMES);
    nextRuntimes.codex.enabled = true;
    const changes = diffSettingsSnapshots(
      createSnapshot({}, { kanban: { doneVisibleDays: 1 } }),
      createSnapshot({}, { agentRuntimes: nextRuntimes, kanban: { doneVisibleDays: 7 } }),
    );

    expect(changes.agentRuntimesChanged).toBe(true);
    expect(changes.kanbanDoneVisibleDaysChanged).toBe(true);
    expect(changes.changedGitProviderRepoPaths).toEqual([]);
  });
});
