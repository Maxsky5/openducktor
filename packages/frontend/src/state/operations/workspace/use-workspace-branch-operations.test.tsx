import { beforeEach, describe, expect, mock, test } from "bun:test";
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
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceBranchOperations>);
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
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

describe("use-workspace-branch-operations", () => {
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

  test("restores fresh cached branch data without loading when returning to a repository", async () => {
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

      expect(gitGetCurrentBranch).toHaveBeenCalledTimes(2);
      expect(gitGetBranches).toHaveBeenCalledTimes(2);
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

  test("keeps a successful branch switch authoritative over an older probe refresh", async () => {
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
        refreshPromise = value.branchProbeController.refreshBranchesForRepo("/repo-a");
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
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

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
      (toast as { error: typeof toast.error }).error = originalToastError;
      await harness.unmount();
    }
  });

  test("keeps the switched branch and rejects when branch list refresh fails after checkout", async () => {
    const branchListError = new Error("branch list unavailable");
    const originalToastError = toast.error;
    const toastError = mock(() => "toast-id");
    (toast as { error: typeof toast.error }).error = toastError as unknown as typeof toast.error;

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

      let caughtError: unknown = null;
      await harness.run(async (value) => {
        try {
          await value.switchBranch("feature");
        } catch (error) {
          caughtError = error;
        }
      });

      expect(harness.getLatest().activeBranch).toEqual({
        name: "feature",
        detached: false,
        revision: "def456",
      });
      expect(harness.getLatest().branches).toEqual(initialBranches);
      expect(caughtError).toBe(branchListError);
      expect(toastError).toHaveBeenCalledWith(
        "Branch switched, but failed to refresh branch list",
        {
          description: "branch list unavailable",
        },
      );
    } finally {
      (toast as { error: typeof toast.error }).error = originalToastError;
      await harness.unmount();
    }
  });
});
