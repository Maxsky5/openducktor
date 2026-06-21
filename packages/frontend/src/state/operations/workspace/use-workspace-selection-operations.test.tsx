import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
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
  const currentArgs = initialArgs;

  const Harness = ({ args }: { args: SelectionHarnessArgs }) => {
    latest = useWorkspaceSelectionOperations({
      ...normalizeSelectionArgs(args),
      hostClient: workspaceHost,
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
    run: async (
      fn: (value: ReturnType<typeof useWorkspaceSelectionOperations>) => Promise<void> | void,
    ) => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      await sharedHarness.run(async () => {
        await fn(latest as ReturnType<typeof useWorkspaceSelectionOperations>);
      });
    },
    getLatest: () => {
      if (!latest) {
        throw new Error("Hook not mounted");
      }

      return latest;
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
  test("trims repo paths before adding a workspace", async () => {
    const workspaceAdd = mock(
      async (): Promise<ReturnType<typeof workspace>> => workspace("/repo-new"),
    );
    const workspaceList = mock(async () => [workspace("/repo-new", true)]);
    workspaceHost.workspaceAdd = workspaceAdd;
    workspaceHost.workspaceList = workspaceList;

    const harness = createSelectionHarness({
      activeRepo: null,
      setActiveRepo: () => {},
      clearTaskData: () => {},
      clearActiveTaskStoreCheck: () => {},
      clearBranchData: () => {},
    });

    try {
      await harness.mount();
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
      expect(workspaceList).toHaveBeenCalled();
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
      await harness.run((value) => {
        value.applyWorkspaceRecords([workspace("/repo-a", true), workspace("/repo-b")]);
      });

      const pendingReorder = harness.run(async (value) => {
        await value.reorderWorkspaces(["repo-b", "repo-a"]);
      });

      await harness.run(async (value) => {
        await value.selectWorkspace("repo-b");
      });

      reorderDeferred.resolve([workspace("/repo-b"), workspace("/repo-a", true)]);
      await pendingReorder;

      expect(latestActiveWorkspace?.repoPath).toBe("/repo-b");
      expect(harness.getLatest().workspaces).toEqual([
        workspace("/repo-a"),
        workspace("/repo-b", true),
      ]);
    } finally {
      reorderDeferred.resolve([workspace("/repo-b"), workspace("/repo-a", true)]);
      await harness.unmount();
    }
  });
});
