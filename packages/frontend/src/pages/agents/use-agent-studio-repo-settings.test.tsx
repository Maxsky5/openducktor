import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const actualHostOperationsModule = await import("@/state/operations/host");

const hostMock = {
  workspaceGetRepoConfig: mock(
    async (_workspaceId: string): Promise<RepoConfig> => ({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/worktrees",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      trustedHooks: false,
      trustedHooksFingerprint: undefined,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }),
  ),
};

let useAgentStudioRepoSettings: typeof import("./use-agent-studio-repo-settings").useAgentStudioRepoSettings;

beforeEach(async () => {
  mock.module("@/state/operations/host", () => ({
    host: hostMock,
  }));
  ({ useAgentStudioRepoSettings } = await import("./use-agent-studio-repo-settings"));
});

afterEach(async () => {
  await restoreMockedModules([["@/state/operations/host", async () => actualHostOperationsModule]]);
});

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRepoSettings, initialProps);

describe("useAgentStudioRepoSettings", () => {
  test("loads repo settings from the canonical repo config query", async () => {
    hostMock.workspaceGetRepoConfig.mockClear();

    const harness = createHookHarness({
      activeWorkspace: {
        workspaceId: "workspace-repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/worktrees/default",
        effectiveWorktreeBasePath: "/worktrees/default",
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-repo");
    expect(harness.getLatest().repoSettings).toEqual({
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/worktrees",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      trustedHooks: false,
      preStartHooks: [],
      postCompleteHooks: [],
      devServers: [],
      worktreeFileCopies: [],
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
    hostMock.workspaceGetRepoConfig.mockClear();

    const harness = createHookHarness({
      activeWorkspace: {
        workspaceId: "workspace-repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/worktrees/default",
        effectiveWorktreeBasePath: "/worktrees/default",
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    await harness.update({ activeWorkspace: null });

    expect(harness.getLatest().repoSettings).toBeNull();

    await harness.unmount();
  });

  test("switches to the next repository key instead of reusing stale derived state", async () => {
    hostMock.workspaceGetRepoConfig.mockClear();
    hostMock.workspaceGetRepoConfig.mockImplementation(
      async (workspaceId: string): Promise<RepoConfig> => ({
        workspaceId,
        workspaceName: workspaceId === "workspace-a" ? "Repo A" : "Repo B",
        repoPath: workspaceId === "workspace-a" ? "/repo-a" : "/repo-b",
        defaultRuntimeKind: "opencode",
        worktreeBasePath: workspaceId === "workspace-a" ? "/worktrees/a" : "/worktrees/b",
        branchPrefix: workspaceId === "workspace-a" ? "feature-a/" : "feature-b/",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        trustedHooks: false,
        trustedHooksFingerprint: undefined,
        hooks: { preStart: [], postComplete: [] },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      }),
    );

    const harness = createHookHarness({
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Repo A",
        repoPath: "/repo-a",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/worktrees/a",
        effectiveWorktreeBasePath: "/worktrees/a",
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-a/");

    await harness.update({
      activeWorkspace: {
        workspaceId: "workspace-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/worktrees/b",
        effectiveWorktreeBasePath: "/worktrees/b",
      },
    });
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-b/");

    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-a");
    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-b");
    expect(harness.getLatest().repoSettings?.worktreeBasePath).toBe("/worktrees/b");

    await harness.unmount();
  });
});
