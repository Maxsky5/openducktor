import { describe, expect, mock, test } from "bun:test";
import type { TaskStoreCheck } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { type PropsWithChildren, StrictMode, useMemo } from "react";
import { toast } from "sonner";
import { QueryProvider } from "@/test-utils/query-provider";
import { type RepoTaskData, taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import {
  createTaskViewSync,
  type TaskSnapshotResult,
  type TaskViewSync,
} from "@openducktor/frontend-core/queries/task-view-sync";
import {
  boardEvent,
  eventCursor,
} from "@openducktor/frontend-core/queries/task-view-sync.test-support";
import { createTaskStreamController } from "@openducktor/frontend-core/tasks/task-stream-controller";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createTaskCardFixture,
  createTaskStoreCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { TaskStreamControllerFactory } from "@openducktor/frontend-core/tasks/use-host-task-stream";
import { useAppLifecycle } from "./use-app-lifecycle";

interface FactoryStateContract {
  queryClient: QueryClient | null;
}

const makeTaskStoreCheck = (): TaskStoreCheck => createTaskStoreCheckFixture();

const lifecycleArgs = {
  activeWorkspace: null,
  openWorkspaces: [],
  refreshBranches: async () => {},
  refreshTaskStoreCheckForRepo: async () => makeTaskStoreCheck(),
  loadWorkspaceTasks: async () => {},
  clearBranchData: () => {},
};

const taskViewSync: TaskViewSync = {
  loadWorkspace: async () => {},
  refreshManually: async () => {},
  refreshAfterTaskRetentionChange: async () => {},
  refreshDocumentsForTasks: async () => {},
  reconcileExternalEvent: async () => {},
  reconcileStreamSnapshot: async () => ({ taskIdsByRepo: new Map(), failures: new Map() }),
  releaseWorkspace: async () => {},
};

describe("useAppLifecycle task stream", () => {
  test("keeps repository reads running when only workspace metadata changes", async () => {
    const refreshBranches = mock(async () => {});
    const refreshTaskStoreCheckForRepo = mock(async () => makeTaskStoreCheck());
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Old name",
        repoPath: "/repo-a",
      },
      refreshBranches,
      refreshTaskStoreCheckForRepo,
      taskStreamControllerFactory: () => ({
        start: async () => {},
        stop: async () => {},
        releaseWorkspace: async () => {},
      }),
    };
    const harness = createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      {
        wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
      },
    );
    try {
      await harness.mount();
      await waitFor(() => expect(refreshBranches).toHaveBeenCalledTimes(1));
      await harness.update({
        ...initialArgs,
        activeWorkspace: { ...initialArgs.activeWorkspace!, workspaceName: "New name" },
      });
      expect(refreshBranches).toHaveBeenCalledTimes(1);
      expect(refreshTaskStoreCheckForRepo).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
  test("loads tasks after switching to a repository the stream has not claimed", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const factory: TaskStreamControllerFactory = ({ onSnapshotStarted }) => ({
      start: async () => onSnapshotStarted("/repo-a"),
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: {
        workspaceId: "workspace-a",
        workspaceName: "Repository A",
        repoPath: "/repo-a",
      },
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      {
        wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
      },
    );

    try {
      await harness.mount();
      expect(loadWorkspaceTasks).not.toHaveBeenCalled();

      await harness.update({
        ...initialArgs,
        activeWorkspace: {
          workspaceId: "workspace-b",
          workspaceName: "Repository B",
          repoPath: "/repo-b",
        },
      });

      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-b"));
      expect(loadWorkspaceTasks).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("loads tasks when a repository becomes active after an empty stream snapshot", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const factory: TaskStreamControllerFactory = ({ getOpenRepoPaths, onSnapshotStarted }) => ({
      start: async () => {
        for (const repoPath of getOpenRepoPaths()) onSnapshotStarted(repoPath);
      },
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      {
        wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
      },
    );

    try {
      await harness.mount();
      expect(loadWorkspaceTasks).not.toHaveBeenCalled();

      await harness.update({
        ...initialArgs,
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Repository A",
          repoPath: "/repo-a",
        },
      });

      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-a"));
      expect(loadWorkspaceTasks).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("loads tasks when prior snapshot data is no longer cached", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const factoryState: FactoryStateContract = { queryClient: null };
    const factory: TaskStreamControllerFactory = ({
      queryClient,
      onSnapshotFinished,
      onSnapshotStarted,
    }) => {
      factoryState.queryClient = queryClient;
      return {
        start: async () => {
          onSnapshotStarted("/repo-a");
          queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [] });
          onSnapshotFinished("/repo-a", true);
        },
        stop: async () => {},
        releaseWorkspace: async () => {},
      };
    };
    const activeWorkspace = {
      workspaceId: "workspace-a",
      workspaceName: "Repository A",
      repoPath: "/repo-a",
    };
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace,
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      {
        wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
      },
    );

    try {
      await harness.mount();
      expect(loadWorkspaceTasks).not.toHaveBeenCalled();
      factoryState.queryClient?.removeQueries({
        queryKey: taskQueryKeys.repoData("/repo-a"),
        exact: true,
      });

      await harness.update({ ...initialArgs, activeWorkspace: null });
      await harness.update({ ...initialArgs, activeWorkspace });

      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-a"));
      expect(loadWorkspaceTasks).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("uses the established stream as the only normal startup task load", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const refreshTaskStoreCheckForRepo = mock(async () => makeTaskStoreCheck());
    const factory: TaskStreamControllerFactory = ({ onSnapshotStarted }) => ({
      start: async () => onSnapshotStarted("/repo"),
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const args = {
      ...lifecycleArgs,
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Repository",
        repoPath: "/repo",
      },
      loadWorkspaceTasks,
      refreshTaskStoreCheckForRepo,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(() => useAppLifecycle(args), undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    try {
      await harness.mount();
      await waitFor(() => expect(refreshTaskStoreCheckForRepo).toHaveBeenCalledTimes(1));

      expect(loadWorkspaceTasks).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(loadWorkspaceTasks).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("does not add a repository retry when initial snapshot recovery fails", async () => {
    const snapshotFailure = new Error("snapshot failed");
    const reconcileStreamSnapshot = mock(async (): Promise<TaskSnapshotResult> => {
      throw snapshotFailure;
    });
    const loadWorkspaceTasks = mock(async () => {});
    const refreshTaskStoreCheckForRepo = mock(async (_repoPath: string, force = false) =>
      createTaskStoreCheckFixture(
        {},
        force
          ? {}
          : {
              taskStoreOk: false,
              taskStorePath: null,
              taskStoreError: "Task store unavailable",
              repoStoreHealth: {
                category: "database_unavailable",
                status: "blocking",
                isReady: false,
                detail: "Task store unavailable",
                databasePath: null,
              },
            },
      ),
    );
    const factory: TaskStreamControllerFactory = ({
      getOpenRepoPaths,
      onDegraded,
      onSnapshotFinished,
      onSnapshotStarted,
      onWorkspaceFailures,
    }) =>
      createTaskStreamController({
        transport: {
          subscribeTaskStream: async (_input, onFrame) => {
            onFrame({
              type: "snapshot_required",
              cursor: {
                epoch: "11111111-1111-4111-8111-111111111111",
                sequence: 0,
              },
              reason: "buffer_gap",
            });
            return {
              subscriptionId: "subscription",
              acknowledge: async () => {},
              unsubscribe: async () => {},
            };
          },
        },
        taskViewSync: { ...taskViewSync, reconcileStreamSnapshot },
        agentSessionViewSync: {
          admitExternalEvent: async (event) => ({
            repoPath: event.repoPath,
            changedTaskIds: [],
          }),
          completeExternalEvents: async () => {},
          cancelReads: () => {},
          reconcileStreamSnapshot: async () => new Map(),
          releaseWorkspace: async () => {},
        },
        getOpenRepoPaths,
        onDegraded,
        onSnapshotFinished,
        onSnapshotStarted,
        onWorkspaceFailures,
      });
    const args = {
      ...lifecycleArgs,
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Repository",
        repoPath: "/repo",
      },
      loadWorkspaceTasks,
      refreshTaskStoreCheckForRepo,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(() => useAppLifecycle(args), undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    try {
      await harness.mount();
      await waitFor(() => expect(reconcileStreamSnapshot).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(refreshTaskStoreCheckForRepo).toHaveBeenCalledTimes(2));
      expect(loadWorkspaceTasks).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("loads repository tasks when the initial stream subscription fails", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const streamFailure = new Error("stream unavailable");
    const factory: TaskStreamControllerFactory = () => ({
      start: async () => {
        throw streamFailure;
      },
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const args = {
      ...lifecycleArgs,
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Repository",
        repoPath: "/repo",
      },
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(() => useAppLifecycle(args), undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    try {
      await harness.mount();
      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo"));
    } finally {
      await harness.unmount();
    }
  });

  test("uses the isolated query client to construct and stop its controller", async () => {
    const unsubscribe = mock(async () => {});
    const start = mock(async () => {});
    const factoryState: FactoryStateContract = { queryClient: null };
    const factory = mock<TaskStreamControllerFactory>(({ queryClient }) => {
      factoryState.queryClient = queryClient;
      queryClient.setQueryData(["task-stream-factory"], "isolated");
      return { start, stop: unsubscribe, releaseWorkspace: async () => {} };
    });
    const args = { ...lifecycleArgs, taskStreamControllerFactory: factory };

    const Harness = () => {
      const lifecycle = useMemo(() => args, []);
      useAppLifecycle(lifecycle);
      return null;
    };
    const harness = createHookHarness(Harness, undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    await harness.mount();
    expect(factory).toHaveBeenCalledTimes(1);
    const factoryInput = factory.mock.calls[0]?.[0];
    expect(factoryState.queryClient?.getQueryData<string>(["task-stream-factory"])).toBe(
      "isolated",
    );
    expect(factoryInput?.getOpenRepoPaths()).toEqual([]);
    expect(start).toHaveBeenCalledTimes(1);

    await harness.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("reports identical degradation episodes after controller recovery", async () => {
    const start = mock(async () => {});
    const stop = mock(async () => {});
    const factory = mock<TaskStreamControllerFactory>(() => ({
      start,
      stop,
      releaseWorkspace: async () => {},
    }));
    const toastError = mock(() => "task-stream-toast");
    const originalToastError = toast.error;
    toast.error = toastError;
    const args = { ...lifecycleArgs, taskStreamControllerFactory: factory };
    const Harness = () => {
      useAppLifecycle(args);
      return null;
    };
    const harness = createHookHarness(Harness, undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    try {
      await harness.mount();
      const onDegraded = factory.mock.calls[0]?.[0].onDegraded;
      if (!onDegraded) throw new Error("Expected task stream degradation handler.");

      onDegraded(new Error("stream unavailable"));
      onDegraded(new Error("stream unavailable"));

      expect(toastError).toHaveBeenCalledTimes(2);
    } finally {
      toast.error = originalToastError;
      await harness.unmount();
    }
  });

  test("gives the stream controller the open workspaces and the active one", async () => {
    const factory = mock<TaskStreamControllerFactory>(() => ({
      start: async () => {},
      stop: async () => {},
      releaseWorkspace: async () => {},
    }));
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: { workspaceId: "workspace-a", workspaceName: "A", repoPath: "/repo-a" },
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      { wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider> },
    );

    try {
      await harness.mount();
      const input = factory.mock.calls[0]?.[0];
      if (!input) throw new Error("Expected a task stream controller.");
      expect(input.getOpenRepoPaths()).toEqual(["/repo-a", "/repo-b"]);
      expect(input.getActiveRepoPath()).toBe("/repo-a");

      await harness.update({
        ...initialArgs,
        activeWorkspace: { workspaceId: "workspace-b", workspaceName: "B", repoPath: "/repo-b" },
        openWorkspaces: [
          { repoPath: "/repo-a", isActive: false },
          { repoPath: "/repo-b", isActive: true },
        ],
      });
      expect(input.getActiveRepoPath()).toBe("/repo-b");
    } finally {
      await harness.unmount();
    }
  });

  test("names the workspaces that a snapshot could not refresh", async () => {
    const factory = mock<TaskStreamControllerFactory>(() => ({
      start: async () => {},
      stop: async () => {},
      releaseWorkspace: async () => {},
    }));
    const toastError = mock<typeof toast.error>(() => "toast");
    const originalToastError = toast.error;
    toast.error = toastError;
    const args = {
      ...lifecycleArgs,
      activeWorkspace: { workspaceId: "workspace-a", workspaceName: "A", repoPath: "/repo-a" },
      taskStreamControllerFactory: factory,
    };
    const harness = createHookHarness(() => useAppLifecycle(args), undefined, {
      wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
    });

    try {
      await harness.mount();
      const input = factory.mock.calls[0]?.[0];
      if (!input) throw new Error("Expected a task stream controller.");

      input.onWorkspaceFailures(new Map([["/repo-b", new Error("Task not readable")]]));

      expect(toastError).toHaveBeenCalledWith("Workspaces did not refresh", {
        description: "/repo-b: Task not readable",
      });
    } finally {
      toast.error = originalToastError;
      await harness.unmount();
    }
  });

  test("StrictMode cleans up subscriptions acquired after lifecycle cleanup", async () => {
    const pendingSubscriptions: Array<{
      resolve: (value: {
        subscriptionId: string;
        acknowledge: () => Promise<void>;
        unsubscribe: () => Promise<void>;
      }) => void;
      unsubscribe: ReturnType<typeof mock>;
    }> = [];
    const factory: TaskStreamControllerFactory = ({
      getOpenRepoPaths,
      onDegraded,
      onWorkspaceFailures,
    }) =>
      createTaskStreamController({
        transport: {
          subscribeTaskStream: async () =>
            await new Promise<{
              subscriptionId: string;
              acknowledge: () => Promise<void>;
              unsubscribe: () => Promise<void>;
            }>((resolve) => {
              const unsubscribe = mock(async () => {});
              pendingSubscriptions.push({ resolve, unsubscribe });
            }),
        },
        taskViewSync,
        agentSessionViewSync: {
          admitExternalEvent: async (event) => ({
            repoPath: event.repoPath,
            changedTaskIds: [],
          }),
          completeExternalEvents: async () => {},
          cancelReads: () => {},
          reconcileStreamSnapshot: async () => new Map(),
          releaseWorkspace: async () => {},
        },
        getOpenRepoPaths,
        onDegraded,
        onWorkspaceFailures,
      });
    const Harness = () => {
      const lifecycle = useMemo(
        () => ({ ...lifecycleArgs, taskStreamControllerFactory: factory }),
        [],
      );
      useAppLifecycle(lifecycle);
      return null;
    };
    const harness = createHookHarness(Harness, undefined, {
      wrapper: ({ children }) => (
        <StrictMode>
          <QueryProvider>{children}</QueryProvider>
        </StrictMode>
      ),
    });

    await harness.mount();
    await harness.unmount();
    expect(pendingSubscriptions).toHaveLength(1);

    for (const [index, pending] of pendingSubscriptions.entries()) {
      pending.resolve({
        subscriptionId: `subscription-${index}`,
        acknowledge: async () => {},
        unsubscribe: pending.unsubscribe,
      });
    }
    await waitFor(
      () => {
        for (const pending of pendingSubscriptions) {
          expect(pending.unsubscribe).toHaveBeenCalledTimes(1);
        }
      },
      { timeout: 1000 },
    );
  });
});

describe("useAppLifecycle open workspaces", () => {
  const workspaceA = { workspaceId: "workspace-a", workspaceName: "A", repoPath: "/repo-a" };
  const workspaceB = { workspaceId: "workspace-b", workspaceName: "B", repoPath: "/repo-b" };
  const idleController: TaskStreamControllerFactory = () => ({
    start: async () => {},
    stop: async () => {},
    releaseWorkspace: async () => {},
  });

  const renderLifecycle = (
    queryClient: QueryClient,
    initialArgs: Parameters<typeof useAppLifecycle>[0],
  ) =>
    createHookHarness(
      (args: Parameters<typeof useAppLifecycle>[0]) => useAppLifecycle(args),
      initialArgs,
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

  test("keeps an inactive open workspace current past its cache time and shows it at once", async () => {
    // Without an observer, an unused list leaves the cache at once.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const tasksList = mock(async (repoPath: string) => [
      createTaskCardFixture({ id: `${repoPath}-task`, title: "Before" }),
    ]);
    const taskViewSync = createTaskViewSync({
      queryClient,
      ports: {
        listTasks: tasksList,
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    // The task store check of the first active workspace does not finish in this test.
    const refreshTaskStoreCheckForRepo = mock((repoPath: string) =>
      repoPath === "/repo-a"
        ? new Promise<TaskStoreCheck>(() => {})
        : Promise.resolve(makeTaskStoreCheck()),
    );
    const loadWorkspaceTasks = mock((repoPath: string) => taskViewSync.loadWorkspace(repoPath));
    const factory = mock<TaskStreamControllerFactory>(idleController);
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      refreshTaskStoreCheckForRepo,
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = renderLifecycle(queryClient, initialArgs);

    try {
      await harness.mount();
      await waitFor(() =>
        expect(queryClient.getQueryState(taskQueryKeys.repoData("/repo-b"))?.status).toBe(
          "success",
        ),
      );
      // The active workspace waits for its task store check.
      expect(tasksList.mock.calls).toEqual([["/repo-b"]]);
      // The list stays cached but does not join the reads of active queries, such as a reconnect.
      const inactiveList = queryClient
        .getQueryCache()
        .find({ queryKey: taskQueryKeys.repoData("/repo-b"), exact: true });
      expect(inactiveList?.getObserversCount()).toBe(1);
      expect(inactiveList?.isActive()).toBe(false);
      expect(factory.mock.calls[0]?.[0].getOpenRepoPaths()).toEqual(["/repo-a", "/repo-b"]);

      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const changed = createTaskCardFixture({ id: "/repo-b-task", title: "Changed while away" });
      await taskViewSync.reconcileExternalEvent(boardEvent("/repo-b", [changed]), eventCursor());
      expect(
        queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-b"))?.tasks,
      ).toEqual([changed]);

      await harness.update({
        ...initialArgs,
        activeWorkspace: workspaceB,
        openWorkspaces: [
          { repoPath: "/repo-a", isActive: false },
          { repoPath: "/repo-b", isActive: true },
        ],
      });
      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-b"));
      expect(
        queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-b"))?.tasks,
      ).toEqual([changed]);
      // The first workspace lost focus before its first load. It now loads as an inactive one.
      await waitFor(() => expect(tasksList.mock.calls).toEqual([["/repo-b"], ["/repo-a"]]));
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  const releasingController = () => {
    const releaseWorkspace = mock(async (_repoPath: string) => {});
    const factory: TaskStreamControllerFactory = () => ({
      start: async () => {},
      stop: async () => {},
      releaseWorkspace,
    });
    return { factory, releaseWorkspace };
  };

  test("releases the task data of a workspace that closes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: [] });
    const { factory, releaseWorkspace } = releasingController();
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      taskStreamControllerFactory: factory,
    };
    const harness = renderLifecycle(queryClient, initialArgs);

    try {
      await harness.mount();
      expect(releaseWorkspace).not.toHaveBeenCalled();

      await harness.update({
        ...initialArgs,
        openWorkspaces: [{ repoPath: "/repo-a", isActive: true }],
      });

      expect(releaseWorkspace.mock.calls).toEqual([["/repo-b"]]);
      // No observer keeps the released list.
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: taskQueryKeys.repoData("/repo-b") })
          ?.getObserversCount(),
      ).toBe(0);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("keeps a closed active workspace until another workspace becomes active", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { factory, releaseWorkspace } = releasingController();
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      taskStreamControllerFactory: factory,
    };
    const harness = renderLifecycle(queryClient, initialArgs);

    try {
      await harness.mount();
      const closedList = {
        ...initialArgs,
        openWorkspaces: [{ repoPath: "/repo-b", isActive: true }],
      };
      await harness.update(closedList);
      expect(releaseWorkspace).not.toHaveBeenCalled();

      await harness.update({ ...closedList, activeWorkspace: workspaceB });
      expect(releaseWorkspace.mock.calls).toEqual([["/repo-a"]]);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("leaves an inactive workspace to the stream snapshot that reads it", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const loadWorkspaceTasks = mock(async () => {});
    const factory: TaskStreamControllerFactory = ({ onSnapshotFinished, onSnapshotStarted }) => ({
      start: async () => {
        onSnapshotStarted("/repo-b");
        queryClient.setQueryData(taskQueryKeys.repoData("/repo-b"), { tasks: [] });
        onSnapshotFinished("/repo-b", true);
      },
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const harness = renderLifecycle(queryClient, {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    });

    try {
      await harness.mount();
      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-a"));
      expect(loadWorkspaceTasks).not.toHaveBeenCalledWith("/repo-b");
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("does not read a failed inactive list again when the workspace records change", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await queryClient
      .fetchQuery({
        queryKey: taskQueryKeys.repoData("/repo-b"),
        queryFn: async (): Promise<RepoTaskData> => {
          throw new Error("task store unavailable");
        },
      })
      .catch(() => {});
    const loadWorkspaceTasks = mock(async () => {});
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      loadWorkspaceTasks,
      taskStreamControllerFactory: idleController,
    };
    const harness = renderLifecycle(queryClient, initialArgs);

    try {
      await harness.mount();
      await harness.update({
        ...initialArgs,
        openWorkspaces: [
          { repoPath: "/repo-a", isActive: true },
          { repoPath: "/repo-b", isActive: false },
        ],
      });
      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-a"));

      expect(loadWorkspaceTasks).not.toHaveBeenCalledWith("/repo-b");
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("loads an inactive workspace when the task stream cannot start", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const loadWorkspaceTasks = mock(async () => {});
    const factory: TaskStreamControllerFactory = ({ onSnapshotStarted }) => ({
      start: async () => {
        onSnapshotStarted("/repo-b");
        throw new Error("stream unavailable");
      },
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const harness = renderLifecycle(queryClient, {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    });

    try {
      await harness.mount();
      // The stream claimed the workspace but cannot read it, so the lifecycle reads it.
      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-b"));
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("loads a reopened workspace whose earlier snapshot failed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [] });
    const loadWorkspaceTasks = mock(async () => {});
    const factory: TaskStreamControllerFactory = ({ onSnapshotFinished, onSnapshotStarted }) => ({
      start: async () => {
        onSnapshotStarted("/repo-b");
        onSnapshotFinished("/repo-b", false);
      },
      stop: async () => {},
      releaseWorkspace: async () => {},
    });
    const initialArgs: Parameters<typeof useAppLifecycle>[0] = {
      ...lifecycleArgs,
      activeWorkspace: workspaceA,
      openWorkspaces: [
        { repoPath: "/repo-a", isActive: true },
        { repoPath: "/repo-b", isActive: false },
      ],
      loadWorkspaceTasks,
      taskStreamControllerFactory: factory,
    };
    const harness = renderLifecycle(queryClient, initialArgs);

    try {
      await harness.mount();
      await harness.update({
        ...initialArgs,
        openWorkspaces: [{ repoPath: "/repo-a", isActive: true }],
      });
      await harness.update({
        ...initialArgs,
        activeWorkspace: workspaceB,
        openWorkspaces: [
          { repoPath: "/repo-a", isActive: false },
          { repoPath: "/repo-b", isActive: true },
        ],
      });

      await waitFor(() => expect(loadWorkspaceTasks).toHaveBeenCalledWith("/repo-b"));
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });
});
