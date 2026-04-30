import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig, WorkspaceRecord } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];
type RepoConfigHost = NonNullable<HookArgs["hostClient"]>;

const createWorkspace = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  workspaceId: "workspace-repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/worktrees/default",
  effectiveWorktreeBasePath: "/worktrees/default",
  ...overrides,
});

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
  test("loads repo settings from the canonical repo config query", async () => {
    const hostClient = createRepoConfigHost();
    const harness = createHookHarness({
      activeWorkspace: createWorkspace(),
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

  test("resets settings when active repo becomes null", async () => {
    const hostClient = createRepoConfigHost();
    const harness = createHookHarness({
      activeWorkspace: createWorkspace(),
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    await harness.update({ activeWorkspace: null, hostClient });

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
      activeWorkspace: createWorkspace({
        workspaceId: "workspace-a",
        workspaceName: "Repo A",
        repoPath: "/repo-a",
        defaultWorktreeBasePath: "/worktrees/a",
        effectiveWorktreeBasePath: "/worktrees/a",
      }),
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-a/");

    await harness.update({
      activeWorkspace: createWorkspace({
        workspaceId: "workspace-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
        defaultWorktreeBasePath: "/worktrees/b",
        effectiveWorktreeBasePath: "/worktrees/b",
      }),
      hostClient,
    });
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-b/");

    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-a");
    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-b");
    expect(harness.getLatest().repoSettings?.worktreeBasePath).toBe("/worktrees/b");

    await harness.unmount();
  });
});
