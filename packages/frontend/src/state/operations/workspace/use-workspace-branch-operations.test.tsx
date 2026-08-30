import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { gitQueryKeys } from "../../queries/git";
import { useWorkspaceBranchOperations } from "./use-workspace-branch-operations";
import { createDeferred, createWorkspaceHostClient, flush } from "./workspace-hook-test-fixtures";
import { IsolatedQueryWrapper } from "./workspace-hook-test-utils";

let workspaceHost = createWorkspaceHostClient();

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

type BranchHarnessArgs = {
  activeRepo: string | null;
};

const createBranchHarness = (initialArgs: BranchHarnessArgs) => {
  let latest: ReturnType<typeof useWorkspaceBranchOperations> | null = null;
  let queryClient: ReturnType<typeof useQueryClient> | null = null;
  let currentArgs = initialArgs;

  const Harness = ({ args }: { args: BranchHarnessArgs }) => {
    queryClient = useQueryClient();
    latest = useWorkspaceBranchOperations({
      activeRepo: args.activeRepo,
      hostClient: workspaceHost,
      updateBranchSyncDegradedForRepo: () => {},
    });
    return null;
  };

  const sharedHarness = createHookHarness(
    Harness,
    { args: currentArgs },
    { wrapper: IsolatedQueryWrapper },
  );

  return {
    mount: async () => {
      await sharedHarness.mount();
    },
    updateArgs: async (nextArgs: BranchHarnessArgs) => {
      currentArgs = nextArgs;
      await sharedHarness.update({ args: currentArgs });
    },
    run: async (
      fn: (value: ReturnType<typeof useWorkspaceBranchOperations>) => Promise<void> | void,
    ) => {
      const hook = latest;
      if (!hook) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(hook);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      return latest;
    },
    getQueryClient: () => {
      if (!queryClient) {
        throw new Error("Hook not mounted");
      }

      return queryClient;
    },
    waitFor: async (
      predicate: (value: ReturnType<typeof useWorkspaceBranchOperations>) => boolean,
    ) => {
      await sharedHarness.waitFor(() => Boolean(latest && predicate(latest)));
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

describe("use-workspace-branch-operations", () => {
  test("shows loading only while an uncached first load is pending", async () => {
    const currentBranchDeferred = createDeferred<{ name: string; detached: boolean }>();
    const branchesDeferred = createDeferred<GitBranch[]>();
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranchDeferred.promise);
    workspaceHost.gitGetBranches = mock(async () => branchesDeferred.promise);
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches();
      });
      await harness.run(flush);

      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
      expect(harness.getLatest().isLoadingBranches).toBe(true);

      if (!refreshPromise) {
        throw new Error("refreshBranches promise was not captured");
      }

      const pendingRefresh = refreshPromise;
      await harness.run(async () => {
        currentBranchDeferred.resolve({ name: "main", detached: false });
        branchesDeferred.resolve([{ name: "main", isCurrent: true, isRemote: false }]);
        await pendingRefresh;
        await flush();
      });

      expect(harness.getLatest().isLoadingBranches).toBe(false);
    } finally {
      currentBranchDeferred.resolve({ name: "main", detached: false });
      branchesDeferred.resolve([]);
      await harness.unmount();
    }
  });

  test("clears branch state on real repository transitions", async () => {
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.waitFor((value) => value.activeBranch?.name === "main");

      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
      });

      await harness.updateArgs({
        activeRepo: "/repo-b",
      });

      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
    } finally {
      await harness.unmount();
    }
  });

  test("restores cached branch data while revalidating the repository", async () => {
    const currentBranches = new Map([
      ["/repo-a", { name: "main", detached: false }],
      ["/repo-b", { name: "develop", detached: false }],
    ]);
    const repoABranches = [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ];
    const repoBranches = new Map([
      ["/repo-a", repoABranches],
      [
        "/repo-b",
        [
          {
            name: "develop",
            isCurrent: true,
            isRemote: false,
          },
        ],
      ],
    ]);
    const gitGetCurrentBranch = mock(async (repoPath: string) => {
      const current = currentBranches.get(repoPath);
      if (!current) {
        throw new Error(`Missing current branch fixture for ${repoPath}`);
      }
      return current;
    });
    const gitGetBranches = mock(async (repoPath: string) => {
      const branches = repoBranches.get(repoPath);
      if (!branches) {
        throw new Error(`Missing branch list fixture for ${repoPath}`);
      }
      return branches;
    });
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      await harness.updateArgs({ activeRepo: "/repo-b" });
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.updateArgs({ activeRepo: "/repo-a" });

      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(harness.getLatest().branches).toEqual(repoABranches);
      expect(harness.getLatest().isLoadingBranches).toBe(false);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(3);
      expect(gitGetBranches).toHaveBeenCalledTimes(3);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes cached branch membership when the current branch is unchanged", async () => {
    const currentBranch: GitCurrentBranch = {
      name: "main",
      detached: false,
      revision: "abc123",
    };
    const initialBranches: GitBranch[] = [{ name: "main", isCurrent: true, isRemote: false }];
    const changedBranches: GitBranch[] = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "feature/external", isCurrent: false, isRemote: false },
    ];
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranch);
    const gitGetBranches = mock(async () => changedBranches);
    gitGetBranches.mockImplementationOnce(async () => initialBranches);
    workspaceHost.gitGetBranches = gitGetBranches;
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.waitFor((value) => value.branches.length === initialBranches.length);

      expect(harness.getLatest().branches).toEqual(initialBranches);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.waitFor((value) => value.branches.length === changedBranches.length);

      expect(harness.getLatest().activeBranch).toEqual(currentBranch);
      expect(harness.getLatest().branches).toEqual(changedBranches);
      expect(gitGetBranches).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test("revalidates each partial branch cache independently", async () => {
    const gitGetCurrentBranch = mock(async (repoPath: string): Promise<GitCurrentBranch> => ({
      name: repoPath === "/repo-a" ? "develop" : "release",
      detached: false,
    }));
    const gitGetBranches = mock(async (repoPath: string): Promise<GitBranch[]> => [
      {
        name: repoPath === "/repo-a" ? "develop" : "release",
        isCurrent: true,
        isRemote: false,
      },
    ]);
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(() => {
        harness.getQueryClient().setQueryData(gitQueryKeys.currentBranch("/repo-a"), {
          name: "main",
          detached: false,
        });
      });
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.waitFor((value) => value.activeBranch?.name === "develop");

      expect(gitGetCurrentBranch).toHaveBeenCalledWith("/repo-a");
      expect(harness.getLatest().activeBranch?.name).toBe("develop");

      await harness.updateArgs({ activeRepo: "/repo-b" });
      await harness.run(() => {
        harness
          .getQueryClient()
          .setQueryData(gitQueryKeys.branches("/repo-b"), [
            { name: "main", isCurrent: true, isRemote: false },
          ]);
      });
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.waitFor((value) => value.branches[0]?.name === "release");

      expect(gitGetBranches).toHaveBeenCalledWith("/repo-b");
      expect(harness.getLatest().branches).toEqual([
        { name: "release", isCurrent: true, isRemote: false },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes cached branches when repository reactivation finds a branch change", async () => {
    const currentBranches = new Map<string, GitCurrentBranch>([
      ["/repo-a", { name: "main", detached: false, revision: "abc123" }],
      ["/repo-b", { name: "develop", detached: false, revision: "def456" }],
    ]);
    const repoBranches = new Map<string, GitBranch[]>([
      ["/repo-a", [{ name: "main", isCurrent: true, isRemote: false }]],
      ["/repo-b", [{ name: "develop", isCurrent: true, isRemote: false }]],
    ]);
    const gitGetCurrentBranch = mock(async (repoPath: string) => {
      const current = currentBranches.get(repoPath);
      if (!current) {
        throw new Error(`Missing current branch fixture for ${repoPath}`);
      }
      return current;
    });
    const gitGetBranches = mock(async (repoPath: string) => {
      const branches = repoBranches.get(repoPath);
      if (!branches) {
        throw new Error(`Missing branch list fixture for ${repoPath}`);
      }
      return branches;
    });
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.updateArgs({ activeRepo: "/repo-b" });
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      currentBranches.set("/repo-a", {
        name: "feature/reactivation",
        detached: false,
        revision: "ghi789",
      });
      repoBranches.set("/repo-a", [
        { name: "main", isCurrent: false, isRemote: false },
        { name: "feature/reactivation", isCurrent: true, isRemote: false },
      ]);
      await harness.updateArgs({ activeRepo: "/repo-a" });

      expect(harness.getLatest().activeBranch?.name).toBe("main");
      expect(harness.getLatest().isLoadingBranches).toBe(false);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      await harness.waitFor((value) => value.activeBranch?.name === "feature/reactivation");
      expect(harness.getLatest().branches).toEqual([
        { name: "main", isCurrent: false, isRemote: false },
        { name: "feature/reactivation", isCurrent: true, isRemote: false },
      ]);
      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(3);
      expect(gitGetBranches).toHaveBeenCalledTimes(3);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps cached branch data visible during a forced refresh", async () => {
    const currentBranchDeferred = createDeferred<{ name: string; detached: boolean }>();
    const branchesDeferred =
      createDeferred<Array<{ name: string; isCurrent: boolean; isRemote: boolean }>>();
    const gitGetCurrentBranch = mock(async () => ({ name: "main", detached: false }));
    gitGetCurrentBranch.mockImplementationOnce(async () => ({ name: "main", detached: false }));
    gitGetCurrentBranch.mockImplementationOnce(async () => currentBranchDeferred.promise);
    const initialBranches = [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ];
    const gitGetBranches = mock(async () => initialBranches);
    gitGetBranches.mockImplementationOnce(async () => initialBranches);
    gitGetBranches.mockImplementationOnce(async () => branchesDeferred.promise);
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches(true);
      });
      await harness.run(flush);

      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
      });
      expect(harness.getLatest().branches).toEqual(initialBranches);
      expect(harness.getLatest().isLoadingBranches).toBe(false);

      if (!refreshPromise) {
        throw new Error("refreshBranches promise was not captured");
      }

      const pendingRefresh = refreshPromise;
      await harness.run(async () => {
        currentBranchDeferred.resolve({ name: "develop", detached: false });
        branchesDeferred.resolve([
          {
            name: "develop",
            isCurrent: true,
            isRemote: false,
          },
        ]);
        await pendingRefresh;
        await flush();
      });

      expect(harness.getLatest().activeBranch?.name).toBe("develop");
    } finally {
      currentBranchDeferred.resolve({ name: "develop", detached: false });
      branchesDeferred.resolve([]);
      await harness.unmount();
    }
  });

  test("keeps a successful branch switch authoritative over an older forced refresh", async () => {
    const currentBranchDeferred = createDeferred<{ name: string; detached: boolean }>();
    const branchesDeferred =
      createDeferred<Array<{ name: string; isCurrent: boolean; isRemote: boolean }>>();
    const mainBranches = [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature",
        isCurrent: false,
        isRemote: false,
      },
    ];
    const featureBranches = [
      {
        name: "main",
        isCurrent: false,
        isRemote: false,
      },
      {
        name: "feature",
        isCurrent: true,
        isRemote: false,
      },
    ];
    const gitGetCurrentBranch = mock(async () => ({ name: "main", detached: false }));
    gitGetCurrentBranch.mockImplementationOnce(async () => ({ name: "main", detached: false }));
    gitGetCurrentBranch.mockImplementationOnce(async () => currentBranchDeferred.promise);
    const gitGetBranches = mock(async () => featureBranches);
    gitGetBranches.mockImplementationOnce(async () => mainBranches);
    gitGetBranches.mockImplementationOnce(async () => branchesDeferred.promise);
    gitGetBranches.mockImplementationOnce(async () => featureBranches);
    workspaceHost.gitGetCurrentBranch = gitGetCurrentBranch;
    workspaceHost.gitGetBranches = gitGetBranches;
    workspaceHost.gitSwitchBranch = mock(async () => ({
      name: "feature",
      detached: false,
    }));

    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches(true);
      });
      await harness.run(flush);

      let switchPromise: Promise<void> | null = null;
      await harness.run((value) => {
        switchPromise = value.switchBranch("feature");
      });
      await harness.run(flush);

      if (!refreshPromise || !switchPromise) {
        throw new Error("Branch operation promises were not captured");
      }

      const pendingRefresh = refreshPromise;
      const pendingSwitch = switchPromise;
      await harness.run(async () => {
        await Promise.all([pendingRefresh, pendingSwitch]);
        await flush();
      });
      await harness.run(async () => {
        currentBranchDeferred.resolve({ name: "main", detached: false });
        branchesDeferred.resolve(mainBranches);
        await flush();
      });

      expect(
        harness
          .getQueryClient()
          .getQueryData<GitCurrentBranch>(gitQueryKeys.currentBranch("/repo-a")),
      ).toEqual({
        name: "feature",
        detached: false,
      });
      expect(
        harness.getQueryClient().getQueryData<GitBranch[]>(gitQueryKeys.branches("/repo-a")),
      ).toEqual(featureBranches);
    } finally {
      currentBranchDeferred.resolve({ name: "main", detached: false });
      branchesDeferred.resolve(mainBranches);
      await harness.unmount();
    }
  });

  test("clears switching state when a cached refresh overlaps a branch switch", async () => {
    const switchDeferred = createDeferred<GitCurrentBranch>();
    const mainBranches: GitBranch[] = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "feature", isCurrent: false, isRemote: false },
    ];
    const featureBranches: GitBranch[] = [
      { name: "main", isCurrent: false, isRemote: false },
      { name: "feature", isCurrent: true, isRemote: false },
    ];
    workspaceHost.gitGetCurrentBranch = mock(async () => ({ name: "main", detached: false }));
    const gitGetBranches = mock(async () => featureBranches);
    gitGetBranches.mockImplementationOnce(async () => mainBranches);
    workspaceHost.gitGetBranches = gitGetBranches;
    workspaceHost.gitSwitchBranch = mock(async () => switchDeferred.promise);
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      let switchPromise: Promise<void> | null = null;
      await harness.run((value) => {
        switchPromise = value.switchBranch("feature");
      });
      await harness.run(flush);
      expect(harness.getLatest().isSwitchingBranch).toBe(true);

      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      if (!switchPromise) {
        throw new Error("switchBranch promise was not captured");
      }

      const pendingSwitch = switchPromise;
      await harness.run(async () => {
        switchDeferred.resolve({ name: "feature", detached: false });
        await pendingSwitch;
        await flush();
      });

      expect(harness.getLatest().isSwitchingBranch).toBe(false);
      expect(
        harness
          .getQueryClient()
          .getQueryData<GitCurrentBranch>(gitQueryKeys.currentBranch("/repo-a")),
      ).toEqual({ name: "feature", detached: false });
    } finally {
      switchDeferred.resolve({ name: "feature", detached: false });
      await harness.unmount();
    }
  });

  test("updates an inactive repository cache after its branch switch succeeds", async () => {
    const switchDeferred = createDeferred<GitCurrentBranch>();
    const mainBranches: GitBranch[] = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "feature", isCurrent: false, isRemote: false },
    ];
    const featureBranches: GitBranch[] = [
      { name: "main", isCurrent: false, isRemote: false },
      { name: "feature", isCurrent: true, isRemote: false },
    ];
    workspaceHost.gitGetCurrentBranch = mock(async () => ({ name: "main", detached: false }));
    const gitGetBranches = mock(async () => featureBranches);
    gitGetBranches.mockImplementationOnce(async () => mainBranches);
    workspaceHost.gitGetBranches = gitGetBranches;
    workspaceHost.gitSwitchBranch = mock(async () => switchDeferred.promise);
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      let switchPromise: Promise<void> | null = null;
      await harness.run((value) => {
        switchPromise = value.switchBranch("feature");
        value.clearBranchData("/repo-a");
      });
      await harness.updateArgs({ activeRepo: "/repo-b" });

      if (!switchPromise) {
        throw new Error("switchBranch promise was not captured");
      }

      const pendingSwitch = switchPromise;
      await harness.run(async () => {
        switchDeferred.resolve({ name: "feature", detached: false });
        await pendingSwitch;
        await flush();
      });

      expect(
        harness
          .getQueryClient()
          .getQueryData<GitCurrentBranch>(gitQueryKeys.currentBranch("/repo-a")),
      ).toEqual({ name: "feature", detached: false });
      expect(
        harness.getQueryClient().getQueryData<GitBranch[]>(gitQueryKeys.branches("/repo-a")),
      ).toEqual(featureBranches);
    } finally {
      switchDeferred.resolve({ name: "feature", detached: false });
      await harness.unmount();
    }
  });

  test("keeps each repository locked while its branch switch is pending", async () => {
    const repoASwitch = createDeferred<GitCurrentBranch>();
    const repoBSwitch = createDeferred<GitCurrentBranch>();
    const gitSwitchBranch = mock(async (repoPath: string, branchName: string) => {
      if (repoPath === "/repo-a") {
        return repoASwitch.promise;
      }

      if (repoPath === "/repo-b") {
        return repoBSwitch.promise;
      }

      throw new Error(`Unexpected repository ${repoPath} for ${branchName}`);
    });
    workspaceHost.gitSwitchBranch = gitSwitchBranch;
    workspaceHost.gitGetBranches = mock(async () => []);
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();

      let repoASwitchPromise: Promise<void> | null = null;
      await harness.run((value) => {
        repoASwitchPromise = value.switchBranch("feature/repo-a");
      });
      await harness.updateArgs({ activeRepo: "/repo-b" });

      let repoBSwitchPromise: Promise<void> | null = null;
      await harness.run((value) => {
        repoBSwitchPromise = value.switchBranch("feature/repo-b");
      });
      await harness.updateArgs({ activeRepo: "/repo-a" });

      expect(harness.getLatest().isSwitchingBranch).toBe(true);
      await harness.run(async (value) => {
        await value.switchBranch("feature/repo-a-duplicate");
      });
      expect(gitSwitchBranch).toHaveBeenCalledTimes(2);

      if (!repoASwitchPromise || !repoBSwitchPromise) {
        throw new Error("Branch switch promises were not captured");
      }

      const pendingRepoASwitch = repoASwitchPromise;
      const pendingRepoBSwitch = repoBSwitchPromise;
      await harness.run(async () => {
        repoASwitch.resolve({ name: "feature/repo-a", detached: false });
        repoBSwitch.resolve({ name: "feature/repo-b", detached: false });
        await Promise.all([pendingRepoASwitch, pendingRepoBSwitch]);
        await flush();
      });

      expect(harness.getLatest().isSwitchingBranch).toBe(false);
    } finally {
      repoASwitch.resolve({ name: "feature/repo-a", detached: false });
      repoBSwitch.resolve({ name: "feature/repo-b", detached: false });
      await harness.unmount();
    }
  });

  test("ignores stale refresh results after the active repository changes", async () => {
    const currentBranchDeferred = createDeferred<{ name: string | undefined; detached: boolean }>();
    workspaceHost.gitGetCurrentBranch = mock(async (repoPath: string) => {
      if (repoPath === "/repo-a") {
        return currentBranchDeferred.promise;
      }
      return {
        name: "develop",
        detached: false,
      };
    });
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();

      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches();
      });

      await harness.updateArgs({
        activeRepo: "/repo-b",
      });
      await harness.run(flush);

      if (!refreshPromise) {
        throw new Error("refreshBranches promise was not captured");
      }

      const pendingRefresh = refreshPromise;
      await harness.run(async () => {
        currentBranchDeferred.resolve({
          name: "main",
          detached: false,
        });
        await pendingRefresh;
        await flush();
      });

      expect(harness.getLatest().activeBranch).toBeNull();
      expect(harness.getLatest().branches).toHaveLength(0);
    } finally {
      currentBranchDeferred.resolve({ name: undefined, detached: false });
      await harness.unmount();
    }
  });

  test("propagates refresh failures after the active repository changes", async () => {
    const currentBranchDeferred = createDeferred<GitCurrentBranch>();
    const refreshError = new Error("branch read failed");
    workspaceHost.gitGetCurrentBranch = mock(async () => currentBranchDeferred.promise);
    workspaceHost.gitGetBranches = mock(async () => []);
    const harness = createBranchHarness({ activeRepo: "/repo-a" });

    try {
      await harness.mount();
      let refreshPromise: Promise<void> | null = null;
      await harness.run((value) => {
        refreshPromise = value.refreshBranches();
      });
      await harness.updateArgs({ activeRepo: "/repo-b" });

      if (!refreshPromise) {
        throw new Error("refreshBranches promise was not captured");
      }

      const caughtErrors = new Array<Error>();
      const pendingRefresh = refreshPromise;
      await harness.run(async () => {
        currentBranchDeferred.reject(refreshError);
        try {
          await pendingRefresh;
        } catch (cause) {
          if (!(cause instanceof Error)) {
            throw new Error("Expected branch refresh to reject with Error.", { cause });
          }
          caughtErrors.push(cause);
        }
        await flush();
      });

      expect(caughtErrors).toEqual([refreshError]);
    } finally {
      currentBranchDeferred.resolve({ name: "main", detached: false });
      await harness.unmount();
    }
  });

  test("skips no-op branch switches when already attached", async () => {
    const gitSwitchBranch = mock(async (_repoPath: string, branchName: string) => ({
      name: branchName,
      detached: false,
    }));
    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
    }));
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ]);
    workspaceHost.gitSwitchBranch = gitSwitchBranch;

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });
      await harness.run(async (value) => {
        await value.switchBranch("main");
      });

      expect(gitSwitchBranch).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("restores the prior branch snapshot and reports the error when switching fails", async () => {
    const switchError = new Error("branch checkout failed");
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");

    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
      revision: "abc123",
    }));
    workspaceHost.gitGetBranches = mock(async () => [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature",
        isCurrent: false,
        isRemote: false,
      },
    ]);
    workspaceHost.gitSwitchBranch = mock(async () => {
      throw switchError;
    });

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      await harness.run(async (value) => {
        await value.switchBranch("feature");
      });

      expect(harness.getLatest().activeBranch).toEqual({
        name: "main",
        detached: false,
        revision: "abc123",
      });
      expect(harness.getLatest().isSwitchingBranch).toBe(false);
      expect(toastError).toHaveBeenCalledWith("Failed to switch branch", {
        description: "branch checkout failed",
      });
    } finally {
      toastError.mockRestore();
      await harness.unmount();
    }
  });

  test("keeps the switched branch and rejects when branch list refresh fails after checkout", async () => {
    const branchListError = new Error("branch list unavailable");
    const toastError = spyOn(toast, "error").mockImplementation(() => "toast-id");

    workspaceHost.gitGetCurrentBranch = mock(async () => ({
      name: "main",
      detached: false,
      revision: "abc123",
    }));

    const initialBranches = [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature",
        isCurrent: false,
        isRemote: false,
      },
    ];
    const gitGetBranches = mock(async () => initialBranches);
    gitGetBranches.mockImplementationOnce(async () => initialBranches);
    gitGetBranches.mockImplementationOnce(async () => {
      throw branchListError;
    });
    workspaceHost.gitGetBranches = gitGetBranches;
    workspaceHost.gitSwitchBranch = mock(async () => ({
      name: "feature",
      detached: false,
      revision: "def456",
    }));

    const harness = createBranchHarness({
      activeRepo: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.refreshBranches();
      });

      const caughtErrors = new Array<Error>();
      await harness.run(async (value) => {
        try {
          await value.switchBranch("feature");
        } catch (cause) {
          if (!(cause instanceof Error)) {
            throw new Error("Expected branch list refresh to reject with Error.", { cause });
          }
          caughtErrors.push(cause);
        }
      });

      expect(harness.getLatest().activeBranch).toEqual({
        name: "feature",
        detached: false,
        revision: "def456",
      });
      expect(harness.getLatest().branches).toEqual(initialBranches);
      expect(caughtErrors).toEqual([branchListError]);
      expect(toastError).toHaveBeenCalledWith(
        "Branch switched, but failed to refresh branch list",
        {
          description: "branch list unavailable",
        },
      );
    } finally {
      toastError.mockRestore();
      await harness.unmount();
    }
  });
});
