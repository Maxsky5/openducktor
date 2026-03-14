import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const hostMock = {
  workspaceGetRepoConfig: mock(
    async (_repoPath: string): Promise<RepoConfig> => ({
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/worktrees",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      trustedHooks: false,
      trustedHooksFingerprint: undefined,
      hooks: { preStart: [], postComplete: [] },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    }),
  ),
};

mock.module("@/state/operations/host", () => ({
  host: hostMock,
}));

const { useAgentStudioRepoSettings } = await import("./use-agent-studio-repo-settings");

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRepoSettings, initialProps);

describe("useAgentStudioRepoSettings", () => {
  test("loads repo settings from the canonical repo config query", async () => {
    hostMock.workspaceGetRepoConfig.mockClear();

    const harness = createHookHarness({
      activeRepo: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("/repo");
    expect(harness.getLatest().repoSettings).toEqual({
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/worktrees",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      trustedHooks: false,
      preStartHooks: [],
      postCompleteHooks: [],
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
      activeRepo: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    await harness.update({ activeRepo: null });

    expect(harness.getLatest().repoSettings).toBeNull();

    await harness.unmount();
  });

  test("switches to the next repository key instead of reusing stale derived state", async () => {
    hostMock.workspaceGetRepoConfig.mockClear();
    hostMock.workspaceGetRepoConfig.mockImplementation(
      async (repoPath: string): Promise<RepoConfig> => ({
        defaultRuntimeKind: "opencode",
        worktreeBasePath: repoPath === "/repo-a" ? "/worktrees/a" : "/worktrees/b",
        branchPrefix: repoPath === "/repo-a" ? "feature-a/" : "feature-b/",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        trustedHooks: false,
        trustedHooksFingerprint: undefined,
        hooks: { preStart: [], postComplete: [] },
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      }),
    );

    const harness = createHookHarness({
      activeRepo: "/repo-a",
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-a/");

    await harness.update({ activeRepo: "/repo-b" });
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-b/");

    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("/repo-a");
    expect(hostMock.workspaceGetRepoConfig).toHaveBeenCalledWith("/repo-b");
    expect(harness.getLatest().repoSettings?.worktreeBasePath).toBe("/worktrees/b");

    await harness.unmount();
  });
});
