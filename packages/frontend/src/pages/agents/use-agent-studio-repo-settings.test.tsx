import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];
type RepoConfigHost = NonNullable<HookArgs["hostClient"]>;

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "/worktrees",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const createRepoConfigHost = (
  loadRepoConfig: (workspaceId: string) => Promise<RepoConfig> = async () => createRepoConfig(),
): RepoConfigHost => ({
  workspaceGetRepoConfig: mock(loadRepoConfig),
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRepoSettings, initialProps);

describe("useAgentStudioRepoSettings", () => {
  test("exposes repo settings loading while the canonical config query is pending", async () => {
    const config = createDeferred<RepoConfig>();
    const hostClient = createRepoConfigHost(() => config.promise);
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      hostClient,
    });

    await harness.mount();

    expect(harness.getLatest()).toMatchObject({
      repoSettings: null,
      isLoadingRepoSettings: true,
    });

    config.resolve(createRepoConfig());
    await harness.waitFor((state) => state.repoSettings !== null);

    expect(harness.getLatest().isLoadingRepoSettings).toBe(false);

    await harness.unmount();
  });

  test("loads repo settings from the canonical repo config query", async () => {
    const hostClient = createRepoConfigHost();
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-repo");
    expect(harness.getLatest().repoSettings).toEqual({
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/worktrees",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      preStartHooks: [],
      postCompleteHooks: [],
      devServers: [],
      worktreeCopyPaths: [],
      agentDefaults: {
        spec: null,
        planner: null,
        build: null,
        qa: null,
      },
    });

    await harness.unmount();
  });

  test.each([
    ["enabled", true, true],
    ["disabled", false, false],
  ])("reports GitHub integration as %s", async (_label, enabled, expected) => {
    const hostClient = createRepoConfigHost(async () =>
      createRepoConfig({
        git: {
          providers: {
            github: { enabled, autoDetected: false },
          },
        },
      }),
    );
    const harness = createHookHarness({ activeWorkspaceId: "workspace-repo", hostClient });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    expect(harness.getLatest().githubIntegrationEnabled).toBe(expected);

    await harness.unmount();
  });

  test("keeps GitHub integration disabled while config is loading or absent", async () => {
    const config = createDeferred<RepoConfig>();
    const hostClient = createRepoConfigHost(() => config.promise);
    const harness = createHookHarness({ activeWorkspaceId: "workspace-repo", hostClient });

    await harness.mount();
    expect(harness.getLatest().githubIntegrationEnabled).toBe(false);

    config.resolve(createRepoConfig());
    await harness.waitFor((state) => !state.isLoadingRepoSettings);
    expect(harness.getLatest().githubIntegrationEnabled).toBe(false);

    await harness.unmount();
  });

  test("resets settings when active repo becomes null", async () => {
    const hostClient = createRepoConfigHost();
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    await harness.update({ activeWorkspaceId: null, hostClient });

    expect(harness.getLatest().repoSettings).toBeNull();

    await harness.unmount();
  });

  test("switches to the next repository key instead of reusing stale derived state", async () => {
    const hostClient = createRepoConfigHost(async (workspaceId) =>
      createRepoConfig({
        workspaceId,
        workspaceName: workspaceId === "workspace-a" ? "Repo A" : "Repo B",
        repoPath: workspaceId === "workspace-a" ? "/repo-a" : "/repo-b",
        worktreeBasePath: workspaceId === "workspace-a" ? "/worktrees/a" : "/worktrees/b",
        branchPrefix: workspaceId === "workspace-a" ? "feature-a/" : "feature-b/",
      }),
    );

    const harness = createHookHarness({
      activeWorkspaceId: "workspace-a",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-a/");

    await harness.update({
      activeWorkspaceId: "workspace-b",
      hostClient,
    });
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-b/");

    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-a");
    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-b");
    expect(harness.getLatest().repoSettings?.worktreeBasePath).toBe("/worktrees/b");

    await harness.unmount();
  });
});
