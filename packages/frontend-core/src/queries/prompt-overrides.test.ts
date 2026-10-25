import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import type { ClientConnection } from "../connection/client-connection";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { createSettingsSnapshotFixture } from "../test-support/shared-test-fixtures";
import { loadEffectivePromptOverrides } from "./prompt-overrides";

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt/",
  defaultTargetBranch: {
    remote: "origin",
    branch: "main",
  },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  promptOverrides: {
    "kickoff.planner_initial": {
      template: "repo planner {{task.id}}",
      baseVersion: 1,
      enabled: true,
    },
  },
  worktreeCopyPaths: [],
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
});

const createSettingsSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    globalPromptOverrides: {
      "kickoff.spec_initial": {
        template: "global kickoff {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
    },
  });

const workspaceGetRepoConfigMock = mock(async (_workspaceId: string): Promise<RepoConfig> =>
  createRepoConfig(),
);

const workspaceListMock = mock(async () => [
  {
    workspaceId: "repo",
    workspaceName: "Repo",
    abbreviation: null,
    tileColor: null,
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/worktrees/repo",
    effectiveWorktreeBasePath: "/worktrees/repo",
  },
]);

const workspaceGetSettingsSnapshotMock = mock(async (): Promise<SettingsSnapshot> =>
  createSettingsSnapshot(),
);

let connection: ClientConnection;

beforeEach(() => {
  workspaceGetRepoConfigMock.mockClear();
  workspaceListMock.mockClear();
  workspaceGetSettingsSnapshotMock.mockClear();
  connection = createTestClientConnection({
    client: {
      workspaceGetRepoConfig: workspaceGetRepoConfigMock,
      workspaceList: workspaceListMock,
      workspaceGetSettingsSnapshot: workspaceGetSettingsSnapshotMock,
    },
  });
});

afterEach(async () => {
  await connection.dispose();
});

describe("loadEffectivePromptOverrides", () => {
  test("deduplicates concurrent loads for the same workspace", async () => {
    const repoDeferred = Promise.withResolvers<RepoConfig>();
    const settingsDeferred = Promise.withResolvers<SettingsSnapshot>();

    workspaceGetRepoConfigMock.mockImplementationOnce(async () => repoDeferred.promise);
    workspaceGetSettingsSnapshotMock.mockImplementationOnce(async () => settingsDeferred.promise);

    const firstLoad = loadEffectivePromptOverrides("repo", connection.queryClient);
    const secondLoad = loadEffectivePromptOverrides("repo", connection.queryClient);

    repoDeferred.resolve(createRepoConfig());
    settingsDeferred.resolve(createSettingsSnapshot());

    const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);

    expect(workspaceGetRepoConfigMock).toHaveBeenCalledTimes(1);
    expect(workspaceListMock).not.toHaveBeenCalled();
    expect(workspaceGetSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult["kickoff.spec_initial"]?.template).toBe("global kickoff {{task.id}}");
    expect(firstResult["kickoff.planner_initial"]?.template).toBe("repo planner {{task.id}}");
  });

  test("normalizes workspace ids before deduplicating concurrent loads", async () => {
    const [firstResult, secondResult] = await Promise.all([
      loadEffectivePromptOverrides("repo", connection.queryClient),
      loadEffectivePromptOverrides(" repo ", connection.queryClient),
    ]);

    expect(workspaceGetRepoConfigMock).toHaveBeenCalledTimes(1);
    expect(workspaceListMock).not.toHaveBeenCalled();
    expect(workspaceGetSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });
});
