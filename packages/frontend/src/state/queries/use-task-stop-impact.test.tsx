import { describe, expect, mock, test } from "bun:test";
import type { TaskStopImpact } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { useTaskStopImpact } from "@/state/queries/use-task-stop-impact";

const createWorkspaceState = (): WorkspaceStateContextValue =>
  ({
    activeWorkspace: {
      workspaceId: "workspace-a",
      workspaceName: "Workspace A",
      repoPath: "/repo",
    },
  }) as WorkspaceStateContextValue;

const createWrapper = () => {
  const workspaceState = createWorkspaceState();
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryProvider useIsolatedClient>
        <WorkspaceStateContext.Provider value={workspaceState}>
          {children}
        </WorkspaceStateContext.Provider>
      </QueryProvider>
    );
  };
};

type HarnessProps = {
  enabled: boolean;
  taskIds: string[];
  taskStopImpactGet: () => Promise<TaskStopImpact>;
};

const createHarness = (initialProps: HarnessProps) =>
  createHookHarness(
    (props: HarnessProps) => {
      const queryClient = useQueryClient();
      const stopImpact = useTaskStopImpact({
        taskIds: props.taskIds,
        operation: "delete",
        enabled: props.enabled,
        readPort: { taskStopImpactGet: props.taskStopImpactGet },
      });
      return { stopImpact, queryClient };
    },
    initialProps,
    { wrapper: createWrapper() },
  );

describe("useTaskStopImpact", () => {
  test("issues no host command while disabled", async () => {
    const taskStopImpactGet = mock(async () => ({ stoppableSessionCount: 1 }));
    const harness = createHarness({ enabled: false, taskIds: ["task-1"], taskStopImpactGet });

    try {
      await harness.mount();
      expect(harness.getLatest().stopImpact).toEqual({
        stoppableSessionCount: null,
        isLoading: false,
        error: null,
      });
      expect(taskStopImpactGet).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("stays pending without a count until the authoritative read resolves", async () => {
    const deferred = createDeferred<{ stoppableSessionCount: number }>();
    const harness = createHarness({
      enabled: true,
      taskIds: ["task-1"],
      taskStopImpactGet: () => deferred.promise,
    });

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toEqual({
        stoppableSessionCount: null,
        isLoading: true,
        error: null,
      });

      await harness.run(() => deferred.resolve({ stoppableSessionCount: 2 }));
      await harness.waitFor(({ stopImpact }) => !stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toEqual({
        stoppableSessionCount: 2,
        isLoading: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces preview failures instead of hiding them behind a null count", async () => {
    const harness = createHarness({
      enabled: true,
      taskIds: ["task-1"],
      taskStopImpactGet: async () => {
        throw new Error("host unavailable");
      },
    });

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.error !== null);
      expect(harness.getLatest().stopImpact).toEqual({
        stoppableSessionCount: null,
        isLoading: false,
        error: "host unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });
});
