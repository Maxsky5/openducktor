import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import {
  createGitProviderConfigFixture,
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { diffSettingsSnapshots } from "./settings-snapshot-changes";

const createSnapshot = (
  workspaces: Record<string, ReturnType<typeof createRepoSettingsConfigFixture>>,
  overrides: Parameters<typeof createSettingsSnapshotFixture>[0] = {},
) => createSettingsSnapshotFixture({ workspaces, ...overrides });

describe("diffSettingsSnapshots", () => {
  test("reports every repository when the previous snapshot is missing", () => {
    const changes = diffSettingsSnapshots(
      undefined,
      createSnapshot({
        "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
        "repo-b": createRepoSettingsConfigFixture("repo-b", "/repo-b"),
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
      "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
      "repo-b": createRepoSettingsConfigFixture(
        "repo-b",
        "/repo-b",
        createGitProviderConfigFixture({ name: "repo-b" }),
      ),
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
        "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "repo-b" }),
        ),
      }),
      createSnapshot({
        "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a"),
        "repo-b": createRepoSettingsConfigFixture(
          "repo-b",
          "/repo-b",
          createGitProviderConfigFixture({ name: "renamed" }),
        ),
      }),
    );

    expect(changes.workspacesChanged).toBe(true);
    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-b"]);
  });

  test("reports a workspace change that does not touch the git provider", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({ "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") }),
      createSnapshot({
        "repo-a": {
          ...createRepoSettingsConfigFixture("repo-a", "/repo-a"),
          hooks: { preStart: ["bun run setup"], postComplete: [] },
        },
      }),
    );

    expect(changes.workspacesChanged).toBe(true);
    expect(changes.changedGitProviderRepoPaths).toEqual([]);
  });

  test("reports a repository whose provider was removed", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({
        "repo-a": createRepoSettingsConfigFixture(
          "repo-a",
          "/repo-a",
          createGitProviderConfigFixture(),
        ),
      }),
      createSnapshot({ "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") }),
    );

    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-a"]);
  });

  test("reports a repository whose provider was disabled", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({
        "repo-a": createRepoSettingsConfigFixture(
          "repo-a",
          "/repo-a",
          createGitProviderConfigFixture(),
        ),
      }),
      createSnapshot({
        "repo-a": createRepoSettingsConfigFixture(
          "repo-a",
          "/repo-a",
          createGitProviderConfigFixture({ enabled: false }),
        ),
      }),
    );

    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-a"]);
  });

  test("reports the new path when a repository path changes", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({ "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") }),
      createSnapshot({ "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-moved") }),
    );

    expect(changes.changedGitProviderRepoPaths).toEqual(["/repo-moved"]);
  });

  test("reports a repository added after the previous snapshot", () => {
    const changes = diffSettingsSnapshots(
      createSnapshot({}),
      createSnapshot({ "repo-a": createRepoSettingsConfigFixture("repo-a", "/repo-a") }),
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

  test("reports a defaults-only agent runtime change", () => {
    const nextRuntimes = structuredClone(DEFAULT_AGENT_RUNTIMES);
    nextRuntimes.codex.defaults.commandNetworkAccess =
      !nextRuntimes.codex.defaults.commandNetworkAccess;
    const changes = diffSettingsSnapshots(
      createSnapshot({}),
      createSnapshot({}, { agentRuntimes: nextRuntimes }),
    );

    expect(changes.agentRuntimesChanged).toBe(true);
    expect(changes.workspacesChanged).toBe(false);
  });
});
