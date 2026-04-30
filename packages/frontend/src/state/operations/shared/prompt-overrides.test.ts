import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt/",
  defaultTargetBranch: {
    remote: "origin",
    branch: "main",
  },
  git: {
    providers: {},
  },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  promptOverrides: {
    "kickoff.planner_initial": {
      template: "repo planner {{task.id}}",
      baseVersion: 1,
      enabled: true,
    },
  },
  worktreeCopyPaths: [],
  agentDefaults: {},
});

const createSettingsSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  workspaces: {},
  chat: { showThinkingMessages: false },
  kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show" },
  autopilot: { rules: [] },
  globalPromptOverrides: {
    "kickoff.spec_initial": {
      template: "global kickoff {{task.id}}",
      baseVersion: 1,
      enabled: true,
    },
  },
});

const workspaceGetRepoConfigMock = mock(
  async (_workspaceId: string): Promise<RepoConfig> => createRepoConfig(),
);

const workspaceListMock = mock(async () => [
  {
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/worktrees/repo",
    effectiveWorktreeBasePath: "/worktrees/repo",
  },
]);

const workspaceGetSettingsSnapshotMock = mock(
  async (): Promise<SettingsSnapshot> => createSettingsSnapshot(),
);

mock.module("../host", () => ({
  host: {
    workspaceGetRepoConfig: workspaceGetRepoConfigMock,
    workspaceList: workspaceListMock,
    workspaceGetSettingsSnapshot: workspaceGetSettingsSnapshotMock,
  },
}));

afterAll(async () => {
  await restoreMockedModules([["../host", () => import("../host")]]);
});

let loadEffectivePromptOverrides: typeof import("./prompt-overrides")["loadEffectivePromptOverrides"];

beforeAll(async () => {
  ({ loadEffectivePromptOverrides } = await import("./prompt-overrides"));
});

beforeEach(async () => {
  workspaceGetRepoConfigMock.mockClear();
  workspaceListMock.mockClear();
  workspaceGetSettingsSnapshotMock.mockClear();
  await clearAppQueryClient();
});

describe("loadEffectivePromptOverrides", () => {
  test("deduplicates concurrent loads for the same workspace", async () => {
    const repoDeferred = Promise.withResolvers<RepoConfig>();
    const settingsDeferred = Promise.withResolvers<SettingsSnapshot>();

    workspaceGetRepoConfigMock.mockImplementationOnce(async () => repoDeferred.promise);
    workspaceGetSettingsSnapshotMock.mockImplementationOnce(async () => settingsDeferred.promise);

    const firstLoad = loadEffectivePromptOverrides("repo");
    const secondLoad = loadEffectivePromptOverrides("repo");

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
      loadEffectivePromptOverrides("repo"),
      loadEffectivePromptOverrides(" repo "),
    ]);

    expect(workspaceGetRepoConfigMock).toHaveBeenCalledTimes(1);
    expect(workspaceListMock).not.toHaveBeenCalled();
    expect(workspaceGetSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });
});
