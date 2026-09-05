import { describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type TaskStoreCheck,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { StrictMode, useMemo } from "react";
import { toast } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
import { taskQueryKeys } from "@/state/queries/tasks";
import type { TaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import type { TaskStreamControllerFactory } from "./use-app-lifecycle";
import { useAppLifecycle } from "./use-app-lifecycle";

interface FactoryStateContract {
  queryClient: QueryClient | null;
}

const createRuntime = (): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-05-10T10:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const makeTaskStoreCheck = (): TaskStoreCheck => createTaskStoreCheckFixture();

const lifecycleArgs = {
  activeWorkspace: null,
  runtimeDefinitions: [],
  refreshBranches: async () => {},
  refreshRepoRuntimeHealth: async () => ({}),
  refreshTaskStoreCheckForRepo: async () => makeTaskStoreCheck(),
  loadWorkspaceTasks: async () => {},
  startRepoRuntime: async () => createRuntime(),
  clearBranchData: () => {},
};

const taskViewSync: TaskViewSync = {
  loadWorkspace: async () => {},
  refreshManually: async () => {},
  refreshAfterLocalMutation: async () => {},
  reconcileExternalEvent: async () => {},
  reconcileStreamSnapshot: async () => [],
};

describe("useAppLifecycle task stream", () => {
  test("loads tasks after switching to a repository the stream has not claimed", async () => {
    const loadWorkspaceTasks = mock(async () => {});
    const factory = ({
      onSnapshotStarted,
    }: {
      onSnapshotStarted?: (repoPath: string | null) => void;
    }) => ({
      start: async () => onSnapshotStarted?.("/repo-a"),
      stop: async () => {},
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
        wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
    const factory: TaskStreamControllerFactory = ({ onSnapshotStarted }) => ({
      start: async () => onSnapshotStarted(null),
      stop: async () => {},
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
        wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
        wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
      wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
    const reconcileStreamSnapshot = mock(async (): Promise<string[]> => {
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
      getActiveRepoPath,
      onDegraded,
      onSnapshotFinished,
      onSnapshotStarted,
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
        metadata: {
          reconcileExternalTaskSyncEvent: () => {},
          invalidateAllTaskMetadata: () => {},
        },
        taskViewSync: { ...taskViewSync, reconcileStreamSnapshot },
        agentSessionViewSync: {
          reconcileExternalEvent: async () => {},
          reconcileStreamSnapshot: async () => {},
        },
        getActiveRepoPath,
        onDegraded,
        onSnapshotFinished,
        onSnapshotStarted,
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
      wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
      wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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
      return { start, stop: unsubscribe };
    });
    const args = { ...lifecycleArgs, taskStreamControllerFactory: factory };

    const Harness = () => {
      const lifecycle = useMemo(() => args, []);
      useAppLifecycle(lifecycle);
      return null;
    };
    const harness = createHookHarness(Harness, undefined, {
      wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
    });

    await harness.mount();
    expect(factory).toHaveBeenCalledTimes(1);
    const factoryInput = factory.mock.calls[0]?.[0];
    expect(factoryState.queryClient?.getQueryData<string>(["task-stream-factory"])).toBe(
      "isolated",
    );
    expect(factoryInput?.getActiveRepoPath()).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);

    await harness.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("reports identical degradation episodes after controller recovery", async () => {
    const start = mock(async () => {});
    const stop = mock(async () => {});
    const factory = mock<TaskStreamControllerFactory>(() => ({ start, stop }));
    const toastError = mock(() => "task-stream-toast");
    const originalToastError = toast.error;
    toast.error = toastError;
    const args = { ...lifecycleArgs, taskStreamControllerFactory: factory };
    const Harness = () => {
      useAppLifecycle(args);
      return null;
    };
    const harness = createHookHarness(Harness, undefined, {
      wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
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

  test("StrictMode cleans up subscriptions acquired after lifecycle cleanup", async () => {
    const pendingSubscriptions: Array<{
      resolve: (value: {
        subscriptionId: string;
        acknowledge: () => Promise<void>;
        unsubscribe: () => Promise<void>;
      }) => void;
      unsubscribe: ReturnType<typeof mock>;
    }> = [];
    const factory: TaskStreamControllerFactory = ({ getActiveRepoPath, onDegraded }) =>
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
        metadata: {
          reconcileExternalTaskSyncEvent: () => {},
          invalidateAllTaskMetadata: () => {},
        },
        taskViewSync,
        agentSessionViewSync: {
          reconcileExternalEvent: async () => {},
          reconcileStreamSnapshot: async () => {},
        },
        getActiveRepoPath,
        onDegraded,
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
          <QueryProvider useIsolatedClient>{children}</QueryProvider>
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
