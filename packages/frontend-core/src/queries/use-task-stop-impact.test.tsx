import "../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { useQueryClient } from "@tanstack/react-query";
import { createActiveWorkspaceWrapper } from "../test-support/active-workspace-wrapper";
import { createHookHarness } from "../test-support/react-hook-harness";
import { createDeferred } from "../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { useTaskStopImpact } from "./use-task-stop-impact";

type HarnessProps = {
  enabled: boolean;
  taskIds: string[];
};
const createHarness = (
  initialProps: HarnessProps,
  taskStopImpactGet: HostClient["taskStopImpactGet"],
) =>
  createHookHarness(
    (props: HarnessProps) => {
      const queryClient = useQueryClient();
      const stopImpact = useTaskStopImpact({
        taskIds: props.taskIds,
        operation: "delete",
        enabled: props.enabled,
      });
      return { stopImpact, queryClient };
    },
    initialProps,
    {
      wrapper: createActiveWorkspaceWrapper(
        createTestClientConnection({ client: { taskStopImpactGet } }),
      ),
    },
  );

describe("useTaskStopImpact", () => {
  test("issues no host command while disabled", async () => {
    const taskStopImpactGet = mock(async () => ({ stoppableSessionCount: 1 }));
    const harness = createHarness({ enabled: false, taskIds: ["task-1"] }, taskStopImpactGet);

    try {
      await harness.mount();
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: null,
        removedWorktreeCount: null,
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
    const harness = createHarness({ enabled: true, taskIds: ["task-1"] }, () => deferred.promise);

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: null,
        removedWorktreeCount: null,
        isLoading: true,
        error: null,
      });

      await harness.run(() => deferred.resolve({ stoppableSessionCount: 2 }));
      await harness.waitFor(({ stopImpact }) => !stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: 2,
        removedWorktreeCount: null,
        isLoading: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reports loading again while a background refetch runs after reopen", async () => {
    const firstRead = createDeferred<{ stoppableSessionCount: number }>();
    const secondRead = createDeferred<{ stoppableSessionCount: number }>();
    const reads = [firstRead.promise, secondRead.promise];
    let readCount = 0;
    const initialProps: HarnessProps = { enabled: true, taskIds: ["task-1"] };
    const harness = createHarness(initialProps, () => {
      const promise = reads[Math.min(readCount, reads.length - 1)]!;
      readCount += 1;
      return promise;
    });

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.isLoading);

      await harness.run(() => firstRead.resolve({ stoppableSessionCount: 1 }));
      await harness.waitFor(({ stopImpact }) => !stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: 1,
        removedWorktreeCount: null,
        isLoading: false,
        error: null,
      });

      // Close and reopen. The old count stays on screen while the new read runs,
      // but loading blocks Confirm.
      await harness.update({ ...initialProps, enabled: false });
      await harness.update({ ...initialProps, enabled: true });
      await harness.waitFor(({ stopImpact }) => stopImpact.isLoading);
      expect(harness.getLatest().stopImpact.stoppableSessionCount).toBe(1);

      await harness.run(() => secondRead.resolve({ stoppableSessionCount: 0 }));
      await harness.waitFor(({ stopImpact }) => !stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: 0,
        removedWorktreeCount: null,
        isLoading: false,
        error: null,
      });
      expect(readCount).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("reports the worktree count of the host", async () => {
    const harness = createHarness({ enabled: true, taskIds: ["task-1"] }, async () => ({
      stoppableSessionCount: 0,
      removedWorktreeCount: 0,
    }));

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => !stopImpact.isLoading);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: 0,
        removedWorktreeCount: 0,
        isLoading: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces preview failures instead of hiding them behind a null count", async () => {
    const harness = createHarness({ enabled: true, taskIds: ["task-1"] }, async () => {
      throw new Error("host unavailable");
    });

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.error !== null);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: null,
        removedWorktreeCount: null,
        isLoading: false,
        error: "host unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reads the count again on retry after a failed read", async () => {
    let failRead = true;
    const harness = createHarness({ enabled: true, taskIds: ["task-1"] }, async () => {
      if (failRead) throw new Error("host unavailable");
      return { stoppableSessionCount: 3 };
    });

    try {
      await harness.mount();
      await harness.waitFor(({ stopImpact }) => stopImpact.error !== null);
      failRead = false;
      await harness.run(({ stopImpact }) => stopImpact.retry());
      await harness.waitFor(({ stopImpact }) => stopImpact.error === null);
      expect(harness.getLatest().stopImpact).toMatchObject({
        stoppableSessionCount: 3,
        isLoading: false,
        error: null,
      });
    } finally {
      await harness.unmount();
    }
  });
});
