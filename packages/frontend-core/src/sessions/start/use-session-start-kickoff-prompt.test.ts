import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { type RepoConfig, type SettingsSnapshot } from "@openducktor/contracts";
import { workspaceQueryKeys } from "../../queries/workspace";
import { createRuntimeHookHarness } from "../../test-support/runtime-hook-harness";
import {
  createDeferred,
  createSettingsSnapshotFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useSessionStartKickoffPrompt } from "./use-session-start-kickoff-prompt";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

type PromptRequest = Parameters<typeof useSessionStartKickoffPrompt>[0];

const configFor = (workspaceId = "a", template = "Repo {{task.id}}") =>
  repoConfigFixture({
    workspaceId,
    workspaceName: workspaceId,
    repoPath: `/${workspaceId}`,
    branchPrefix: "odt",
    promptOverrides: { "kickoff.spec_initial": { template, baseVersion: 1, enabled: true } },
  });

const inputFor = (workspaceId: string | null = "a"): PromptRequest => ({
  selectedTargetBranch: "",
  kickoff: {
    workspaceId,
    task: null,
    request: { taskId: "TASK-1", role: "spec", launchActionId: "spec_initial" },
  },
});

const renderPrompt = (input: PromptRequest, connection = createTestClientConnection()) => {
  const loading: boolean[] = [];
  const harness = createRuntimeHookHarness(
    (props: PromptRequest) => {
      const state = useSessionStartKickoffPrompt(props);
      loading.push(state.isKickoffPromptLoading);
      return state;
    },
    input,
    { connection, seedSettingsSnapshot: false },
  );
  return { ...harness, loading };
};

const seedSettings = (connection: ReturnType<typeof createTestClientConnection>) => {
  connection.queryClient.setQueryData(
    workspaceQueryKeys.settingsSnapshot(),
    createSettingsSnapshotFixture({
      globalPromptOverrides: {
        "kickoff.spec_initial": { template: "Global {{task.id}}", baseVersion: 1, enabled: true },
      },
    }),
  );
};

describe("useSessionStartKickoffPrompt", () => {
  test("shows a cached kickoff preview on its first render without loading", async () => {
    const readConfig = mock(async () => configFor());
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: readConfig },
    });
    connection.queryClient.setQueryData(workspaceQueryKeys.repoConfig("a"), configFor());
    seedSettings(connection);
    const harness = renderPrompt(inputFor(), connection);
    try {
      await harness.mount();
      expect(harness.getLatest().kickoffPrompt).toBe("Repo TASK-1");
      expect(harness.loading).not.toContain(true);
      expect(readConfig).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("waits for missing settings and config before showing the preview", async () => {
    const config = createDeferred<RepoConfig>();
    const settings = createDeferred<SettingsSnapshot>();
    const connection = createTestClientConnection({
      client: {
        workspaceGetRepoConfig: async () => config.promise,
        workspaceGetSettingsSnapshot: async () => settings.promise,
      },
    });
    const harness = renderPrompt(inputFor(), connection);
    try {
      await harness.mount();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      await harness.run(() => config.resolve(configFor()));
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      await harness.run(() => settings.resolve(createSettingsSnapshotFixture()));
      await harness.waitFor((state) => !state.isKickoffPromptLoading);
      expect(harness.getLatest().kickoffPrompt).toBe("Repo TASK-1");
    } finally {
      config.resolve(configFor());
      settings.resolve(createSettingsSnapshotFixture());
      await harness.unmount();
    }
  });

  test("keeps a read error visible until explicit retry", async () => {
    const retry = createDeferred<RepoConfig>();
    const readConfig = mock()
      .mockRejectedValueOnce(new Error("Prompt settings unavailable"))
      .mockReturnValueOnce(retry.promise);
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: readConfig },
    });
    seedSettings(connection);
    const harness = renderPrompt(inputFor(), connection);
    try {
      await harness.mount();
      await harness.waitFor((state) => state.kickoffPromptError !== null);
      expect(harness.getLatest().kickoffPromptError).toBe("Prompt settings unavailable");
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
      expect(readConfig).toHaveBeenCalledTimes(1);
      await harness.run((state) => state.onRetryKickoffPrompt());
      await harness.waitFor((state) => state.isKickoffPromptLoading);
      expect(harness.getLatest().kickoffPromptError).toBeNull();
      await harness.run(() => retry.resolve(configFor()));
      await harness.waitFor((state) => state.kickoffPrompt === "Repo TASK-1");
      expect(harness.getLatest().kickoffPromptError).toBeNull();
      expect(readConfig).toHaveBeenCalledTimes(2);
    } finally {
      retry.resolve(configFor());
      await harness.unmount();
    }
  });

  test("keeps cached content visible during a failed refresh", async () => {
    const refresh = createDeferred<RepoConfig>();
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: async () => refresh.promise },
    });
    connection.queryClient.setQueryData(workspaceQueryKeys.repoConfig("a"), configFor(), {
      updatedAt: 0,
    });
    seedSettings(connection);
    const harness = renderPrompt(inputFor(), connection);
    try {
      await harness.mount();
      expect(harness.getLatest().kickoffPrompt).toBe("Repo TASK-1");
      await harness.run(() => refresh.reject(new Error("Refresh failed")));
      expect(harness.getLatest().kickoffPrompt).toBe("Repo TASK-1");
      expect(harness.getLatest().kickoffPromptError).toBeNull();
      expect(harness.loading).not.toContain(true);
    } finally {
      await harness.unmount();
    }
  });

  test("does not show an earlier workspace's late result after a new request or close", async () => {
    const pending = createDeferred<RepoConfig>();
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: async () => pending.promise },
    });
    seedSettings(connection);
    connection.queryClient.setQueryData(
      workspaceQueryKeys.repoConfig("b"),
      configFor("b", "Current {{task.id}}"),
    );
    const harness = renderPrompt(inputFor("a"), connection);
    try {
      await harness.mount();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(true);
      await harness.update(inputFor("b"));
      expect(harness.getLatest().kickoffPrompt).toBe("Current TASK-1");
      await harness.run(() => pending.resolve(configFor()));
      expect(harness.getLatest().kickoffPrompt).toBe("Current TASK-1");
      await harness.update({ kickoff: undefined, selectedTargetBranch: "" });
      expect(harness.getLatest().kickoffPrompt).toBeUndefined();
      expect(harness.getLatest().isKickoffPromptLoading).toBe(false);
    } finally {
      pending.resolve(configFor());
      await harness.unmount();
    }
  });

  test("rebuilds branch choices at once without fetching settings again", async () => {
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(workspaceQueryKeys.repoConfig("a"), configFor());
    seedSettings(connection);
    const input = inputFor();
    input.kickoff!.request = {
      taskId: "TASK-1",
      role: "build",
      launchActionId: "build_pull_request_generation",
    };
    const harness = renderPrompt(input, connection);
    try {
      await harness.mount();
      expect(harness.getLatest().kickoffPrompt).toContain("Pull request base:\nmain");
      await harness.update({ ...input, selectedTargetBranch: "refs/remotes/upstream/release" });
      expect(harness.getLatest().kickoffPrompt).toContain("Pull request base:\nrelease");
      await harness.update({ ...input, selectedTargetBranch: "refs/remotes/origin/main" });
      expect(harness.getLatest().kickoffPrompt).toContain("Pull request base:\nmain");
      expect(harness.loading).not.toContain(true);
    } finally {
      await harness.unmount();
    }
  });

  test("shows context-free previews without workspace reads", async () => {
    const readConfig = mock(async () => configFor());
    const connection = createTestClientConnection({
      client: { workspaceGetRepoConfig: readConfig },
    });
    const harness = renderPrompt(inputFor(null), connection);
    try {
      await harness.mount();
      expect(harness.getLatest().kickoffPrompt).toContain("TASK-1");
      expect(harness.loading).not.toContain(true);
      expect(readConfig).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
