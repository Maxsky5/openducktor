import { describe, expect, mock, test } from "bun:test";
import type { ExternalTaskSyncEvent, TaskEventCursor } from "@openducktor/contracts";
import type { TaskStreamFrame, TaskStreamSubscription } from "@/lib/shell-bridge";
import type { TaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "./task-stream-controller";

const epoch = "11111111-1111-4111-8111-111111111111";
const cursor = (sequence: number): TaskEventCursor => ({ epoch, sequence });
const event = (taskId: string): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: `event-${taskId}`,
  repoPath: "/repo",
  taskIds: [taskId],
  removedTaskIds: [],
  emittedAt: "2026-04-10T13:10:00.000Z",
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

type SubscriptionRecord = {
  acknowledge: ReturnType<typeof mock<(cursor: TaskEventCursor) => Promise<void>>>;
  input: { cursor: TaskEventCursor | null };
  listener: (frame: TaskStreamFrame) => void;
  onTerminalFailure: (error: unknown) => void;
  unsubscribe: ReturnType<typeof mock<() => Promise<void>>>;
};

const createHarness = ({
  onSubscribe,
  taskViewSync: taskViewSyncOverrides,
  getActiveRepoPath = () => "/repo",
}: {
  onSubscribe?: (record: SubscriptionRecord, index: number) => Promise<TaskStreamSubscription>;
  taskViewSync?: Partial<TaskViewSync>;
  getActiveRepoPath?: () => string | null;
} = {}) => {
  const records: SubscriptionRecord[] = [];
  const metadata = {
    reconcileExternalTaskSyncEvent: mock((_event: ExternalTaskSyncEvent) => {}),
    invalidateAllTaskMetadata: mock(() => {}),
  };
  const taskViewSync: TaskViewSync = {
    loadWorkspace: async () => {},
    refreshManually: async () => {},
    refreshAfterLocalMutation: async () => {},
    reconcileExternalEvent: mock(async () => {}),
    reconcileStreamSnapshot: mock(async () => {}),
    ...taskViewSyncOverrides,
  };
  const transport = {
    subscribeTaskStream: mock(async (input, listener, onTerminalFailure) => {
      const record: SubscriptionRecord = {
        acknowledge: mock(async (_cursor: TaskEventCursor) => {}),
        input,
        listener,
        onTerminalFailure: onTerminalFailure ?? (() => {}),
        unsubscribe: mock(async () => {}),
      };
      records.push(record);
      if (onSubscribe) return onSubscribe(record, records.length - 1);
      return {
        subscriptionId: `subscription-${records.length}`,
        acknowledge: record.acknowledge,
        unsubscribe: record.unsubscribe,
      };
    }),
  };
  const onDegraded = mock((_error: unknown) => {});
  const controller = createTaskStreamController({
    transport,
    metadata,
    taskViewSync,
    getActiveRepoPath,
    onDegraded,
  });

  return {
    controller,
    metadata,
    onDegraded,
    records,
    taskViewSync,
    transport,
    emit: (index: number, frame: TaskStreamFrame) => records[index]?.listener(frame),
    failTerminally: (index: number, error: unknown) => records[index]?.onTerminalFailure(error),
  };
};

describe("task stream controller recovery", () => {
  test("application failure closes the subscription, recovers from a snapshot, and resumes", async () => {
    const applicationFailure = new Error("upper failed");
    let applications = 0;
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: mock(async () => {
          applications += 1;
          if (applications === 1) throw applicationFailure;
        }),
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.records[1]?.input).toEqual({ cursor: null });
    expect(harness.onDegraded).toHaveBeenCalledWith(applicationFailure);

    harness.emit(1, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();
    harness.emit(1, { type: "change", cursor: cursor(8), event: event("resumed") });
    await flush();

    expect(harness.taskViewSync.reconcileStreamSnapshot).toHaveBeenCalledWith("/repo");
    expect(harness.records[1]?.acknowledge.mock.calls).toEqual([[cursor(7)], [cursor(8)]]);
    expect(applications).toBe(2);
  });

  test("ambiguous ACK failure recovers from the last acknowledged cursor without reapplying", async () => {
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 0) {
          record.acknowledge.mockImplementation(async (nextCursor) => {
            if (nextCursor.sequence === 1) throw new Error("ack unavailable");
          });
        }
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.emit(0, { type: "change", cursor: cursor(1), event: event("one") });
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
    expect(harness.records[1]?.acknowledge).not.toHaveBeenCalled();

    harness.emit(1, { type: "change", cursor: cursor(1), event: event("one") });
    await flush();
    harness.emit(1, { type: "change", cursor: cursor(2), event: event("two") });
    await flush();

    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(3);
    expect(harness.records[1]?.acknowledge.mock.calls).toEqual([[cursor(1)], [cursor(2)]]);
  });

  test("a recovery subscription failure remains degraded without a second attempt", async () => {
    const recoveryFailure = new Error("recovery unavailable");
    const applicationFailure = new Error("application failed");
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) throw recoveryFailure;
        return {
          subscriptionId: "initial",
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
      taskViewSync: {
        reconcileExternalEvent: async () => {
          throw applicationFailure;
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(applicationFailure);
  });

  test("rejects an initial subscription failure and lets stop complete", async () => {
    const subscribeFailure = new Error("stream unavailable");
    const harness = createHarness({
      onSubscribe: async () => {
        throw subscribeFailure;
      },
    });

    const firstStart = harness.controller.start();
    const secondStart = harness.controller.start();

    expect(secondStart).toBe(firstStart);
    await expect(firstStart).rejects.toBe(subscribeFailure);
    await expect(harness.controller.start()).rejects.toBe(subscribeFailure);
    await expect(harness.controller.stop()).resolves.toBeUndefined();
  });

  test("recovers one terminal stream failure from the last acknowledged cursor", async () => {
    const terminalFailure = new Error("stream ended");
    const secondTerminalFailure = new Error("stream ended again");
    const harness = createHarness();

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, terminalFailure);
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);

    harness.failTerminally(1, secondTerminalFailure);
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("keeps a terminal recovery acquisition failure in the degraded episode", async () => {
    const terminalFailure = new Error("stream ended");
    const recoveryFailure = new Error("replacement unavailable");
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) throw recoveryFailure;
        return {
          subscriptionId: "initial",
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, terminalFailure);
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(terminalFailure);
  });

  test("drains a replay delivered before the replacement terminal subscription resolves", async () => {
    const harness = createHarness({
      onSubscribe: async (record, index) => {
        if (index === 1) {
          record.listener({ type: "change", cursor: cursor(1), event: event("replayed") });
        }
        return {
          subscriptionId: `subscription-${index}`,
          acknowledge: record.acknowledge,
          unsubscribe: record.unsubscribe,
        };
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, new Error("stream ended"));
    await flush();

    expect(harness.taskViewSync.reconcileExternalEvent).toHaveBeenCalledTimes(2);
    expect(harness.records[1]?.acknowledge).toHaveBeenCalledWith(cursor(1));
  });

  test("ignores terminal failures from an obsolete subscription", async () => {
    const harness = createHarness();

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("zero") });
    await flush();
    harness.failTerminally(0, new Error("stream ended"));
    await flush();
    harness.failTerminally(0, new Error("obsolete stream ended"));
    await flush();

    expect(harness.records).toHaveLength(2);
    expect(harness.records[1]?.input).toEqual({ cursor: cursor(0) });
  });

  test("does not acknowledge a snapshot until its refresh completes", async () => {
    const snapshotRefresh = deferred<void>();
    const harness = createHarness({
      taskViewSync: {
        reconcileStreamSnapshot: async () => snapshotRefresh.promise,
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();

    expect(harness.records[0]?.acknowledge).not.toHaveBeenCalled();
    snapshotRefresh.resolve();
    await flush();

    expect(harness.records[0]?.acknowledge).toHaveBeenCalledWith(cursor(7));
  });

  test("a recovery snapshot application failure closes the recovery stream without looping", async () => {
    const snapshotFailure = new Error("snapshot failed");
    const changeFailure = new Error("change failed");
    let changeApplications = 0;
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: async () => {
          changeApplications += 1;
          if (changeApplications === 1) throw changeFailure;
        },
        reconcileStreamSnapshot: async () => {
          throw snapshotFailure;
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    harness.emit(1, { type: "snapshot_required", cursor: cursor(7), reason: "buffer_gap" });
    await flush();
    await flush();

    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
    expect(harness.records[1]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.onDegraded).toHaveBeenCalledWith(changeFailure);
  });

  test("concurrent starts share acquisition and stop waits for acquisition and teardown", async () => {
    const acquired = deferred<TaskStreamSubscription>();
    const teardown = deferred<void>();
    const transport = {
      subscribeTaskStream: mock(async () => acquired.promise),
    };
    const controller = createTaskStreamController({
      transport,
      metadata: {
        reconcileExternalTaskSyncEvent: () => {},
        invalidateAllTaskMetadata: () => {},
      },
      taskViewSync: {
        loadWorkspace: async () => {},
        refreshManually: async () => {},
        refreshAfterLocalMutation: async () => {},
        reconcileExternalEvent: async () => {},
        reconcileStreamSnapshot: async () => {},
      },
      getActiveRepoPath: () => "/repo",
      onDegraded: () => {},
    });
    const firstStart = controller.start();
    const secondStart = controller.start();
    const stop = controller.stop();
    const unsubscribe = mock(async () => teardown.promise);
    acquired.resolve({ subscriptionId: "pending", acknowledge: async () => {}, unsubscribe });
    await flush();

    expect(firstStart).toBe(secondStart);
    expect(transport.subscribeTaskStream).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    teardown.resolve();
    await Promise.all([firstStart, secondStart, stop]);
  });

  test("ignores frames delivered by the closed subscription", async () => {
    const harness = createHarness({
      taskViewSync: {
        reconcileExternalEvent: async () => {
          throw new Error("application failed");
        },
      },
    });

    await harness.controller.start();
    harness.emit(0, { type: "change", cursor: cursor(0), event: event("failed") });
    await flush();
    expect(harness.records).toHaveLength(2);

    harness.emit(0, { type: "snapshot_required", cursor: cursor(99), reason: "buffer_gap" });
    await flush();

    expect(harness.taskViewSync.reconcileStreamSnapshot).not.toHaveBeenCalled();
    expect(harness.transport.subscribeTaskStream).toHaveBeenCalledTimes(2);
  });
});
