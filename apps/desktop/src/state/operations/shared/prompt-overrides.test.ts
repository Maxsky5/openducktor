import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";

const createRepoConfig = (): RepoConfig => ({
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt/",
  defaultTargetBranch: {
    remote: "origin",
    branch: "main",
  },
  git: {
    providers: {},
  },
  trustedHooks: false,
  hooks: { preStart: [], postComplete: [] },
  promptOverrides: {
    "kickoff.planner_initial": {
      template: "repo planner {{task.id}}",
      baseVersion: 1,
      enabled: true,
    },
  },
  worktreeFileCopies: [],
  agentDefaults: {},
});

const createSettingsSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  repos: {},
  chat: { showThinkingMessages: false },
  globalPromptOverrides: {
    "kickoff.spec_initial": {
      template: "global kickoff {{task.id}}",
      baseVersion: 1,
      enabled: true,
    },
  },
});

const workspaceGetRepoConfigMock = mock(
  async (_repoPath: string): Promise<RepoConfig> => createRepoConfig(),
);

const workspaceGetSettingsSnapshotMock = mock(
  async (): Promise<SettingsSnapshot> => createSettingsSnapshot(),
);

mock.module("../host", () => ({
  host: {
    workspaceGetRepoConfig: workspaceGetRepoConfigMock,
    workspaceGetSettingsSnapshot: workspaceGetSettingsSnapshotMock,
  },
}));

let loadEffectivePromptOverrides: typeof import("./prompt-overrides")["loadEffectivePromptOverrides"];

beforeAll(async () => {
  ({ loadEffectivePromptOverrides } = await import("./prompt-overrides"));
});

beforeEach(async () => {
  workspaceGetRepoConfigMock.mockClear();
  workspaceGetSettingsSnapshotMock.mockClear();
  await clearAppQueryClient();
});

describe("loadEffectivePromptOverrides", () => {
  test("deduplicates concurrent loads for the same repo", async () => {
    const repoDeferred = Promise.withResolvers<RepoConfig>();
    const settingsDeferred = Promise.withResolvers<SettingsSnapshot>();

    workspaceGetRepoConfigMock.mockImplementationOnce(async () => repoDeferred.promise);
    workspaceGetSettingsSnapshotMock.mockImplementationOnce(async () => settingsDeferred.promise);

    const firstLoad = loadEffectivePromptOverrides("/repo");
    const secondLoad = loadEffectivePromptOverrides("/repo");

    repoDeferred.resolve(createRepoConfig());
    settingsDeferred.resolve(createSettingsSnapshot());

    const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);

    expect(workspaceGetRepoConfigMock).toHaveBeenCalledTimes(1);
    expect(workspaceGetSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult["kickoff.spec_initial"]?.template).toBe("global kickoff {{task.id}}");
    expect(firstResult["kickoff.planner_initial"]?.template).toBe("repo planner {{task.id}}");
  });

  test("normalizes repo paths before deduplicating concurrent loads", async () => {
    const [firstResult, secondResult] = await Promise.all([
      loadEffectivePromptOverrides("/repo"),
      loadEffectivePromptOverrides(" /repo "),
    ]);

    expect(workspaceGetRepoConfigMock).toHaveBeenCalledTimes(1);
    expect(workspaceGetSettingsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });
});
