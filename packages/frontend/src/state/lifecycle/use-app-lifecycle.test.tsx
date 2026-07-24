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
import type { TaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import type { TaskStreamControllerFactory } from "./use-app-lifecycle";
import { useAppLifecycle } from "./use-app-lifecycle";

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
  reconcileStreamSnapshot: async () => {},
};

describe("useAppLifecycle task stream", () => {
  test("uses the isolated query client to construct and stop its controller", async () => {
    const unsubscribe = mock(async () => {});
    const start = mock(async () => {});
    const factoryState: { queryClient: QueryClient | null } = { queryClient: null };
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
    toast.error = toastError as typeof toast.error;
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
