import { describe, expect, mock, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderHealth,
  type RepoConfig,
  type RepositoryGitProviderContext,
} from "@openducktor/contracts";
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
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
  ...overrides,
});

const createRepoConfigHost = (
  loadRepoConfig: (workspaceId: string) => Promise<RepoConfig> = async () => createRepoConfig(),
  loadProviderContext: (repoPath: string) => Promise<RepositoryGitProviderContext> = async () =>
    null,
): RepoConfigHost => ({
  workspaceGetRepoConfig: mock(loadRepoConfig),
  workspaceGetGitProviderContext: mock(loadProviderContext),
});

const createProviderContext = ({
  enabled = true,
  available = true,
  supportsPullRequestReview = true,
}: {
  enabled?: boolean;
  available?: boolean;
  supportsPullRequestReview?: boolean;
} = {}): NonNullable<RepositoryGitProviderContext> => {
  const health: GitProviderHealth = {
    providerId: "github",
    enabled,
    available,
    executablePath: available ? "gh" : null,
    version: available ? "gh version test" : null,
    authenticated: available,
    account: available ? "octocat" : null,
    repositoryMappingValid: available,
  };
  if (!available) {
    health.reason = "Run `gh auth login` to connect GitHub.";
  }
  return {
    descriptor: {
      ...GITHUB_PROVIDER_DESCRIPTOR,
      capabilities: {
        supportsPullRequests: true,
        supportsPullRequestReview,
      },
    },
    config: {
      id: "github",
      enabled,
      autoDetected: false,
    },
    health,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRepoSettings, initialProps);

describe("useAgentStudioRepoSettings", () => {
  test("exposes repo settings loading while the canonical config query is pending", async () => {
    const config = createDeferred<RepoConfig>();
    const hostClient = createRepoConfigHost(() => config.promise);
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      activeRepoPath: "/repo",
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
      activeRepoPath: "/repo",
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
    ["no configured provider", null],
    ["disabled provider", createProviderContext({ enabled: false, available: false })],
    ["healthy GitHub", createProviderContext()],
    ["supported but unhealthy GitHub", createProviderContext({ available: false })],
  ])("loads %s context through its repository query", async (_label, context) => {
    const hostClient = createRepoConfigHost(undefined, async () => context);
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      activeRepoPath: "/repo",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => !state.isLoadingGitProviderContext);

    expect(hostClient.workspaceGetGitProviderContext).toHaveBeenCalledWith("/repo");
    expect(harness.getLatest().gitProviderContext).toEqual(context);

    await harness.unmount();
  });

  test("resets settings when active repo becomes null", async () => {
    const hostClient = createRepoConfigHost();
    const harness = createHookHarness({
      activeWorkspaceId: "workspace-repo",
      activeRepoPath: "/repo",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings !== null);

    await harness.update({ activeWorkspaceId: null, activeRepoPath: null, hostClient });

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
      activeRepoPath: "/repo-a",
      hostClient,
    });

    await harness.mount();
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-a/");

    await harness.update({
      activeWorkspaceId: "workspace-b",
      activeRepoPath: "/repo-b",
      hostClient,
    });
    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature-b/");

    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-a");
    expect(hostClient.workspaceGetRepoConfig).toHaveBeenCalledWith("workspace-b");
    expect(harness.getLatest().repoSettings?.worktreeBasePath).toBe("/worktrees/b");

    await harness.unmount();
  });
});
