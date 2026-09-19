import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { taskQueryKeys } from "../../queries/tasks";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import {
  createDeferred,
  createWorkspaceHostClient,
  workspace,
} from "./workspace-hook-test-fixtures";
import { IsolatedQueryWrapper } from "./workspace-hook-test-utils";

let workspaceHost = createWorkspaceHostClient();

beforeEach(() => {
  workspaceHost = createWorkspaceHostClient();
});

type SelectionHarnessArgs = {
  activeWorkspace?: ActiveWorkspace | null;
  setActiveWorkspace?: (workspace: ActiveWorkspace | null) => void;
  activeRepo?: string | null;
  setActiveRepo?: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveTaskStoreCheck: () => void;
  clearBranchData: () => void;
};

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const normalizeSelectionArgs = ({
  activeWorkspace,
  setActiveWorkspace,
  activeRepo,
  setActiveRepo,
  ...rest
}: SelectionHarnessArgs): Omit<
  Parameters<typeof useWorkspaceSelectionOperations>[0],
  "hostClient"
> => ({
  ...rest,
  activeWorkspace: activeWorkspace ?? (activeRepo ? createActiveWorkspace(activeRepo) : null),
  setActiveWorkspace:
    setActiveWorkspace ??
    ((workspace) => {
      setActiveRepo?.(workspace?.repoPath ?? null);
    }),
});

const createSelectionHarness = (initialArgs: SelectionHarnessArgs) => {
  let latest: ReturnType<typeof useWorkspaceSelectionOperations> | null = null;
  let queryClient: QueryClient | null = null;
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: SelectionHarnessArgs }) => {
    latest = useWorkspaceSelectionOperations({
      ...normalizeSelectionArgs(args),
      hostClient: workspaceHost,
    });
    queryClient = useQueryClient();
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
    run: async (
      fn: (value: ReturnType<typeof useWorkspaceSelectionOperations>) => Promise<void> | void,
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
    getQueryClient: (): QueryClient => {
      if (!queryClient) {
        throw new Error("Hook not mounted");
      }
      return queryClient;
    },
    waitFor: async (
      predicate: (value: ReturnType<typeof useWorkspaceSelectionOperations>) => boolean,
    ) => {
      await sharedHarness.waitFor(() => Boolean(latest && predicate(latest)));
    },
    unmount: async () => {
      await sharedHarness.unmount();
    },
  };
};

describe("use-workspace-selection-operations", () => {
  test("waits for the workspace catalog before reporting loaded state", async () => {
    const catalogDeferred =
      createDeferred<Awaited<ReturnType<typeof workspaceHost.workspaceCatalogGet>>>();
    workspaceHost.workspaceCatalogGet = mock(async () => catalogDeferred.promise);
    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      expect(harness.getLatest().isLoadingWorkspaces).toBe(true);
      expect(harness.getLatest().hasLoadedWorkspaceList).toBe(false);

      catalogDeferred.resolve({
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      });
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);

      expect(harness.getLatest().isLoadingWorkspaces).toBe(false);
    } finally {
      catalogDeferred.resolve({
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      });
      await harness.unmount();
    }
  });

  test("reports workspace catalog load errors", async () => {
    workspaceHost.workspaceCatalogGet = mock(async () => {
      throw new Error("Catalog load failed");
    });
    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.workspaceLoadError !== null);

      expect(harness.getLatest().workspaceLoadError?.message).toBe("Catalog load failed");
      expect(harness.getLatest().hasLoadedWorkspaceList).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshWorkspaces retries a failed workspace catalog load", async () => {
    let catalogCalls = 0;
    workspaceHost.workspaceCatalogGet = mock(async () => {
      catalogCalls += 1;
      if (catalogCalls === 1) {
        throw new Error("Catalog load failed");
      }
      return {
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      };
    });
    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.workspaceLoadError !== null);
      await harness.run((value) => value.refreshWorkspaces());
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);

      expect(catalogCalls).toBe(2);
      expect(harness.getLatest().workspaceLoadError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("adds a workspace from the mutation record without re-reading the list or catalog", async () => {
    const workspaceAdd = mock(async (): Promise<ReturnType<typeof workspace>> =>
      workspace("/repo-new", true),
    );
    const workspaceList = mock(async () => [workspace("/repo-old", true)]);
    const workspaceCatalogGet = mock(async () => ({
      openWorkspaces: [workspace("/repo-old", true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }));
    const setActiveRepo = mock((_repoPath: string | null) => {});
    workspaceHost.workspaceAdd = workspaceAdd;
    workspaceHost.workspaceList = workspaceList;
    workspaceHost.workspaceCatalogGet = workspaceCatalogGet;

    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);
      expect(workspaceList).toHaveBeenCalledTimes(1);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);

      await harness.run(async (value) => {
        await value.addWorkspace({
          workspaceId: "repo-new",
          workspaceName: "Repo New",
          repoPath: "  /repo-new  ",
        });
      });

      expect(workspaceAdd).toHaveBeenCalledWith({
        workspaceId: "repo-new",
        workspaceName: "Repo New",
        repoPath: "/repo-new",
      });
      expect(workspaceList).toHaveBeenCalledTimes(1);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
      await harness.waitFor((state) => state.workspaces.length === 2);
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-old", false),
        workspace("/repo-new", true),
      ]);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-new");
    } finally {
      await harness.unmount();
    }
  });

  test("clears dependent state before committing a successful repo switch", async () => {
    const callOrder: string[] = [];
    const setActiveRepo = mock((repoPath: string | null) => {
      callOrder.push(`setActiveRepo:${repoPath}`);
    });
    const clearTaskData = mock(() => {
      callOrder.push("clearTaskData");
    });
    const clearActiveTaskStoreCheck = mock(() => {
      callOrder.push("clearActiveTaskStoreCheck");
    });
    const clearBranchData = mock(() => {
      callOrder.push("clearBranchData");
    });

    workspaceHost.workspaceSelect = mock(async () => workspace("/repo-a", true));
    workspaceHost.workspaceList = mock(async () => [workspace("/repo-a", true)]);

    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData,
      clearActiveTaskStoreCheck,
      clearBranchData,
    });

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.selectWorkspace("repo-a");
      });

      expect(callOrder.slice(0, 4)).toEqual([
        "clearTaskData",
        "clearActiveTaskStoreCheck",
        "clearBranchData",
        "setActiveRepo:/repo-a",
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("switches workspace without reading the workspace list or catalog", async () => {
    const workspaceSelect = mock(async () => workspace("/repo-a", true));
    const workspaceList = mock(async () => [workspace("/repo-a"), workspace("/repo-b", true)]);
    const workspaceCatalogGet = mock(async () => ({
      openWorkspaces: [workspace("/repo-a"), workspace("/repo-b", true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }));
    const setActiveRepo = mock((_repoPath: string | null) => {});
    workspaceHost.workspaceSelect = workspaceSelect;
    workspaceHost.workspaceList = workspaceList;
    workspaceHost.workspaceCatalogGet = workspaceCatalogGet;

    const harness = createSelectionHarness({
      activeRepo: "/repo-b",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);
      expect(workspaceList).toHaveBeenCalledTimes(1);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);

      await harness.run((value) => value.selectWorkspace("repo-a"));
      await harness.waitFor((state) => state.workspaces.at(0)?.isActive === true);

      expect(workspaceSelect).toHaveBeenCalledWith("repo-a");
      expect(workspaceList).toHaveBeenCalledTimes(1);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-a");
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-a", true),
        workspace("/repo-b", false),
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("clears previous active workspaces when merging a new active record", async () => {
    const setActiveRepo = mock((_repoPath: string | null) => {});
    const harness = createSelectionHarness({
      activeRepo: "/repo-old",
      setActiveRepo,
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([workspace("/repo-old", true), workspace("/repo-b")]);
      });
      await harness.run((value) => {
        value.applyWorkspaceRecord(workspace("/repo-c", true));
      });
      await harness.waitFor((state) => state.workspaces.length === 3);

      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-old", false),
        workspace("/repo-b"),
        workspace("/repo-c", true),
      ]);
      expect(setActiveRepo).toHaveBeenCalledWith("/repo-c");
    } finally {
      await harness.unmount();
    }
  });

  test("reorders workspaces without clearing switch-dependent state", async () => {
    const clearTaskData = mock(() => {});
    const clearActiveTaskStoreCheck = mock(() => {});
    const clearBranchData = mock(() => {});
    const workspaceReorder = mock(async (workspaceOrder: string[]) =>
      workspaceOrder.map((workspaceId) => workspace(`/${workspaceId}`)),
    );
    workspaceHost.workspaceReorder = workspaceReorder;

    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData,
      clearActiveTaskStoreCheck,
      clearBranchData,
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([
          workspace("/repo-a", true),
          workspace("/repo-b"),
          workspace("/repo-c"),
        ]);
      });
      await harness.waitFor((state) => state.workspaces.length === 3);
      await harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-c", "repo-a", "repo-b"]);
      });
      await harness.waitFor((state) => state.workspaces.at(0)?.workspaceId === "repo-c");

      expect(workspaceReorder).toHaveBeenCalledWith(["repo-c", "repo-a", "repo-b"]);
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-c"),
        workspace("/repo-a"),
        workspace("/repo-b"),
      ]);
      expect(clearTaskData).not.toHaveBeenCalled();
      expect(clearActiveTaskStoreCheck).not.toHaveBeenCalled();
      expect(clearBranchData).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("ignores stale reorder responses when a newer drag finishes first", async () => {
    const firstReorder = createDeferred<ReturnType<typeof workspace>[]>();
    const secondReorder = createDeferred<ReturnType<typeof workspace>[]>();
    const workspaceReorder = mock((workspaceOrder: string[]) => {
      if (workspaceOrder[0] === "repo-c") {
        return firstReorder.promise;
      }
      return secondReorder.promise;
    });
    workspaceHost.workspaceReorder = workspaceReorder;

    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([
          workspace("/repo-a", true),
          workspace("/repo-b"),
          workspace("/repo-c"),
        ]);
      });
      await harness.waitFor((state) => state.workspaces.length === 3);

      const firstCall = harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-c", "repo-a", "repo-b"]);
      });
      const secondCall = harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-b", "repo-c", "repo-a"]);
      });

      secondReorder.resolve([
        workspace("/repo-b"),
        workspace("/repo-c"),
        workspace("/repo-a", true),
      ]);
      await secondCall;

      firstReorder.resolve([
        workspace("/repo-c"),
        workspace("/repo-a", true),
        workspace("/repo-b"),
      ]);
      await firstCall;
      await harness.waitFor((state) => state.workspaces.at(0)?.workspaceId === "repo-b");

      expect(workspaceReorder).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-b"),
        workspace("/repo-c"),
        workspace("/repo-a", true),
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("reorders workspaces optimistically before the host confirms the new order", async () => {
    const reorderDeferred = createDeferred<ReturnType<typeof workspace>[]>();
    workspaceHost.workspaceReorder = mock(async () => reorderDeferred.promise);

    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([
          workspace("/repo-a", true),
          workspace("/repo-b"),
          workspace("/repo-c"),
        ]);
      });
      await harness.waitFor((state) => state.workspaces.length === 3);

      let pendingReorder: Promise<void> | null = null;
      await harness.run((value) => {
        pendingReorder = value.reorderWorkspaces(["repo-c", "repo-a", "repo-b"]);
      });
      await harness.waitFor((state) => state.workspaces.at(0)?.workspaceId === "repo-c");

      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-c"),
        workspace("/repo-a", true),
        workspace("/repo-b"),
      ]);

      await harness.run(async () => {
        reorderDeferred.resolve([
          workspace("/repo-c"),
          workspace("/repo-a", true),
          workspace("/repo-b"),
        ]);
        await pendingReorder;
      });
    } finally {
      await harness.unmount();
    }
  });

  test("preserves the current active workspace during refresh when no record is marked active", async () => {
    let latestActiveWorkspace: ActiveWorkspace | null = createActiveWorkspace("/repo-old");
    const harness = createSelectionHarness({
      activeWorkspace: latestActiveWorkspace,
      setActiveWorkspace: (workspace) => {
        latestActiveWorkspace = workspace;
      },
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([workspace("/repo-old", false), workspace("/repo-b", false)]);
      });

      expect(latestActiveWorkspace?.repoPath).toBe("/repo-old");
    } finally {
      await harness.unmount();
    }
  });

  test("ignores a stale reorder response after a newer workspace switch starts", async () => {
    const reorderDeferred = createDeferred<ReturnType<typeof workspace>[]>();
    let latestActiveWorkspace: ActiveWorkspace | null = createActiveWorkspace("/repo-a");
    workspaceHost.workspaceReorder = mock(async () => reorderDeferred.promise);
    workspaceHost.workspaceSelect = mock(async () => workspace("/repo-b", true));
    workspaceHost.workspaceList = mock(async () => [
      workspace("/repo-a"),
      workspace("/repo-b", true),
    ]);
    const harness = createSelectionHarness({
      activeWorkspace: latestActiveWorkspace,
      setActiveWorkspace: (workspace) => {
        latestActiveWorkspace = workspace;
      },
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.workspaces.length === 2);
      await harness.run((value) => {
        value.applyWorkspaceRecords([workspace("/repo-a", true), workspace("/repo-b")]);
      });
      await harness.waitFor((state) => state.workspaces.at(0)?.isActive === true);

      const pendingReorder = harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-b", "repo-a"]);
      });

      await harness.run(async (value) => {
        await value.selectWorkspace("repo-b");
      });

      reorderDeferred.resolve([workspace("/repo-b"), workspace("/repo-a", true)]);
      await pendingReorder;
      await harness.waitFor(
        (state) =>
          state.workspaces.at(0)?.workspaceId === "repo-b" &&
          state.workspaces.at(0)?.isActive === true,
      );

      expect(latestActiveWorkspace?.repoPath).toBe("/repo-b");
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-b", true),
        workspace("/repo-a"),
      ]);
    } finally {
      reorderDeferred.resolve([workspace("/repo-b"), workspace("/repo-a", true)]);
      await harness.unmount();
    }
  });

  test("rolls back the optimistic order when a reorder fails", async () => {
    workspaceHost.workspaceReorder = mock(async () => {
      throw new Error("Reorder rejected");
    });
    const toastError = spyOn(toast, "error").mockImplementation(() => "");
    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.run((value) => {
        value.applyWorkspaceRecords([
          workspace("/repo-a", true),
          workspace("/repo-b"),
          workspace("/repo-c"),
        ]);
      });
      await harness.waitFor((state) => state.workspaces.length === 3);

      await harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-c", "repo-a", "repo-b"]);
      });
      await harness.waitFor((state) => state.workspaces.at(0)?.workspaceId === "repo-a");

      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-a", true),
        workspace("/repo-b"),
        workspace("/repo-c"),
      ]);
      expect(toastError).toHaveBeenCalledWith("Failed to reorder repositories", {
        description: "Reorder rejected",
      });
    } finally {
      await harness.unmount();
      toastError.mockRestore();
    }
  });

  test("reloads the workspace list when a stale reorder fails after a switch", async () => {
    const reorderStarted = createDeferred<void>();
    const reorderDeferred = createDeferred<ReturnType<typeof workspace>[]>();
    let listCalls = 0;
    const workspaceList = mock(async () => {
      listCalls += 1;
      return [workspace("/repo-a"), workspace("/repo-b", true)];
    });
    workspaceHost.workspaceReorder = mock(async () => {
      reorderStarted.resolve();
      return reorderDeferred.promise;
    });
    workspaceHost.workspaceSelect = mock(async () => workspace("/repo-b", true));
    workspaceHost.workspaceList = workspaceList;
    const toastError = spyOn(toast, "error").mockImplementation(() => "");
    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.workspaces.length === 2);

      const pendingReorder = harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-b", "repo-a"]);
      });
      await reorderStarted.promise;

      await harness.run(async (value) => {
        await value.selectWorkspace("repo-b");
      });

      reorderDeferred.reject(new Error("Reorder rejected"));
      await pendingReorder;
      await harness.waitFor((state) => state.workspaces.at(0)?.workspaceId === "repo-a");

      expect(listCalls).toBe(2);
      expect(toastError).toHaveBeenCalledWith("Failed to reorder repositories", {
        description: "Reorder rejected",
      });
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-a"),
        workspace("/repo-b", true),
      ]);
    } finally {
      reorderDeferred.reject(new Error("Reorder rejected"));
      await harness.unmount();
      toastError.mockRestore();
    }
  });

  test("does not report a failure when a newer switch cancels the stale reorder reload", async () => {
    const reorderDeferred = createDeferred<ReturnType<typeof workspace>[]>();
    const selectDeferred = createDeferred<ReturnType<typeof workspace>>();
    const reloadDeferred = createDeferred<ReturnType<typeof workspace>[]>();
    const reloadStarted = createDeferred<void>();
    let listCalls = 0;
    workspaceHost.workspaceList = mock(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return [workspace("/repo-a", true), workspace("/repo-b")];
      }
      reloadStarted.resolve();
      return reloadDeferred.promise;
    });
    workspaceHost.workspaceReorder = mock(async () => reorderDeferred.promise);
    workspaceHost.workspaceSelect = mock(async () => selectDeferred.promise);
    const toastError = spyOn(toast, "error").mockImplementation(() => "");
    const harness = createSelectionHarness({
      activeRepo: "/repo-a",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.workspaces.length === 2);

      await harness.run(async (value) => {
        const pendingReorder = value.reorderWorkspaces(["repo-b", "repo-a"]);
        const pendingSwitch = value.selectWorkspace("repo-b");

        reorderDeferred.reject(new Error("Reorder rejected"));
        await reloadStarted.promise;
        expect(listCalls).toBe(2);

        selectDeferred.resolve(workspace("/repo-b", true));
        await pendingSwitch;
        await pendingReorder;
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith("Failed to reorder repositories", {
        description: "Reorder rejected",
      });
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-b", true),
        workspace("/repo-a"),
      ]);
    } finally {
      selectDeferred.resolve(workspace("/repo-b", true));
      reorderDeferred.reject(new Error("Reorder rejected"));
      reloadDeferred.resolve([workspace("/repo-a", true)]);
      await harness.unmount();
      toastError.mockRestore();
    }
  });

  test("drops repository-path and workspace-id caches after committed removal", async () => {
    workspaceHost.workspaceRemove = mock(async () => ({
      catalog: {
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      },
      removedWorktrees: [],
    }));
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
        tasks: [{ id: "task-1" }],
      });
      queryClient.setQueryData(["workspace", "repo-config", "repo"], { workspaceId: "repo" });

      await harness.run((value) =>
        value.removeWorkspace({
          workspaceId: "repo",
          expectedRepoPath: "/repo",
          removeTaskWorktrees: false,
        }),
      );

      expect(queryClient.getQueryData(taskQueryKeys.repoData("/repo"))).toBeUndefined();
      expect(queryClient.getQueryData(["workspace", "repo-config", "repo"])).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("applies the close response without reading the catalog", async () => {
    const workspaceCatalogGet = mock(async () => ({
      openWorkspaces: [workspace("/repo", true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }));
    workspaceHost.workspaceCatalogGet = workspaceCatalogGet;
    workspaceHost.workspaceClose = mock(async () => ({
      openWorkspaces: [],
      closedWorkspaces: [workspace("/repo")],
      incompleteRemovals: [],
    }));
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);

      await harness.run((value) =>
        value.closeWorkspace({ workspaceId: "repo", expectedRepoPath: "/repo" }),
      );

      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().closedWorkspaces).toEqual([workspace("/repo")]);
      expect(harness.getLatest().workspaces).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("applies the reopen response without reading the catalog", async () => {
    const workspaceCatalogGet = mock(async () => ({
      openWorkspaces: [],
      closedWorkspaces: [workspace("/repo")],
      incompleteRemovals: [],
    }));
    workspaceHost.workspaceCatalogGet = workspaceCatalogGet;
    workspaceHost.workspaceReopen = mock(async () => ({
      openWorkspaces: [workspace("/repo", true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }));
    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);

      await harness.run((value) =>
        value.reopenWorkspace({ workspaceId: "repo", expectedRepoPath: "/repo" }),
      );

      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().closedWorkspaces).toEqual([]);
      expect(harness.getLatest().workspaces).toEqual([workspace("/repo", true)]);
    } finally {
      await harness.unmount();
    }
  });

  test("applies the remove response without reading the catalog", async () => {
    const workspaceCatalogGet = mock(async () => ({
      openWorkspaces: [workspace("/repo", true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }));
    workspaceHost.workspaceCatalogGet = workspaceCatalogGet;
    workspaceHost.workspaceRemove = mock(async () => ({
      catalog: {
        openWorkspaces: [],
        closedWorkspaces: [workspace("/other")],
        incompleteRemovals: [],
      },
      removedWorktrees: [],
    }));
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);
      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);

      await harness.run((value) =>
        value.removeWorkspace({
          workspaceId: "repo",
          expectedRepoPath: "/repo",
          removeTaskWorktrees: false,
        }),
      );

      expect(workspaceCatalogGet).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().workspaces).toEqual([]);
      expect(harness.getLatest().closedWorkspaces).toEqual([workspace("/other")]);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes workspace caches after a failed removal", async () => {
    let listCalls = 0;
    let catalogCalls = 0;
    workspaceHost.workspaceList = mock(async () => {
      listCalls += 1;
      return [workspace("/repo", true)];
    });
    workspaceHost.workspaceCatalogGet = mock(async () => {
      catalogCalls += 1;
      return {
        openWorkspaces: [workspace("/repo", true)],
        closedWorkspaces: [],
        incompleteRemovals: [],
      };
    });
    workspaceHost.workspaceRemove = mock(async () => {
      throw new Error("Removal stopped after a durable change");
    });
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.hasLoadedWorkspaceList);

      await expect(
        harness.run((value) =>
          value.removeWorkspace({
            workspaceId: "repo",
            expectedRepoPath: "/repo",
            removeTaskWorktrees: false,
          }),
        ),
      ).rejects.toThrow("Removal stopped after a durable change");

      expect(listCalls).toBe(2);
      expect(catalogCalls).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("preserves a removal failure when its cache refresh also fails", async () => {
    workspaceHost.workspaceRemove = mock(async () => {
      throw new Error("Removal stopped at task store cleanup");
    });
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      spyOn(queryClient, "invalidateQueries").mockImplementation(async () => {
        throw new Error("Workspace refresh failed");
      });

      await expect(
        harness.run((value) =>
          value.removeWorkspace({
            workspaceId: "repo",
            expectedRepoPath: "/repo",
            removeTaskWorktrees: false,
          }),
        ),
      ).rejects.toThrow("Removal stopped at task store cleanup");
    } finally {
      await harness.unmount();
    }
  });

  test("rejects a second lifecycle action while the first action is pending", async () => {
    const closeStarted = createDeferred<void>();
    const closeResult =
      createDeferred<Awaited<ReturnType<typeof workspaceHost.workspaceCatalogGet>>>();
    workspaceHost.workspaceClose = mock(async () => {
      closeStarted.resolve();
      return closeResult.promise;
    });
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      const first = harness.run((value) =>
        value.closeWorkspace({ workspaceId: "repo", expectedRepoPath: "/repo" }),
      );
      await closeStarted.promise;

      await expect(
        harness.run((value) =>
          value.reopenWorkspace({ workspaceId: "repo", expectedRepoPath: "/repo" }),
        ),
      ).rejects.toThrow("A workspace action is already in progress");

      closeResult.resolve({
        openWorkspaces: [],
        closedWorkspaces: [workspace("/repo")],
        incompleteRemovals: [],
      });
      await first;
      expect(workspaceHost.workspaceClose).toHaveBeenCalledTimes(1);
    } finally {
      closeResult.resolve({
        openWorkspaces: [],
        closedWorkspaces: [workspace("/repo")],
        incompleteRemovals: [],
      });
      await harness.unmount();
    }
  });

  test("keeps a committed lifecycle action successful when cache refresh fails", async () => {
    workspaceHost.workspaceClose = mock(async () => ({
      openWorkspaces: [],
      closedWorkspaces: [workspace("/repo")],
      incompleteRemovals: [],
    }));
    const harness = createSelectionHarness({
      activeRepo: "/repo",
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
      const queryClient = harness.getQueryClient();
      spyOn(queryClient, "invalidateQueries").mockImplementation(async () => {
        throw new Error("Workspace refresh failed");
      });

      await expect(
        harness.run((value) =>
          value.closeWorkspace({ workspaceId: "repo", expectedRepoPath: "/repo" }),
        ),
      ).resolves.toBeUndefined();
      expect(harness.getLatest().closedWorkspaces).toEqual([workspace("/repo")]);
    } finally {
      await harness.unmount();
    }
  });
});
