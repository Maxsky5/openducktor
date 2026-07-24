import { describe, expect, test } from "bun:test";
import type {
  ExternalTaskSyncEvent,
  TaskEventCursor,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import { createTaskEventStream } from "./task-event-stream";

const epoch = "be8e34ef-2e0e-4e9a-a63f-72719f95c7b7";
const otherEpoch = "2f24a820-463a-4cf7-b75c-3db3393b7d51";
const firstSubscriptionId = "78a3be5c-f828-4bb7-b219-390b7306bc07";
const secondSubscriptionId = "5630586c-4a12-4580-a158-229d3bb96cb6";

const event = (id: string): ExternalTaskSyncEvent => ({
  eventId: `event-${id}`,
  kind: "external_task_created",
  repoPath: "/repo",
  taskId: `task-${id}`,
  emittedAt: "2026-04-10T13:00:00.000Z",
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
};

const createStream = () => {
  const failures: unknown[] = [];
  let nextSubscriptionId = 0;
  const stream = createTaskEventStream({
    epochFactory: () => epoch,
    reporter: { report: (failure) => failures.push(failure) },
    subscriptionIdFactory: () =>
      [firstSubscriptionId, secondSubscriptionId][nextSubscriptionId++] ?? crypto.randomUUID(),
  });
  return { failures, stream };
};

const acknowledge = (
  stream: ReturnType<typeof createTaskEventStream>,
  subscriptionId: string,
  cursor: TaskEventCursor,
) => stream.acknowledge({ subscriptionId, cursor });

describe("createTaskEventStream", () => {
  test("delivers ordered live changes and replays from the acknowledged cursor", async () => {
    const { stream } = createStream();
    const initial: TaskEventStreamFrame[] = [];
    const first = stream.subscribe({ cursor: null }, (frame) => initial.push(frame));
    await flush();
    const snapshot = initial[0];
    expect(snapshot).toMatchObject({ type: "snapshot_required", cursor: { epoch, sequence: 0 } });
    if (!snapshot) {
      throw new Error("expected initial snapshot frame");
    }
    acknowledge(stream, first.subscriptionId, snapshot.cursor);

    stream.publish(event("1"));
    stream.publish(event("2"));
    await flush();
    expect(initial.slice(1).map((frame) => frame.cursor.sequence)).toEqual([1, 2]);
    acknowledge(stream, first.subscriptionId, { epoch, sequence: 1 });

    const replayed: TaskEventStreamFrame[] = [];
    stream.subscribe({ cursor: { epoch, sequence: 1 } }, (frame) => replayed.push(frame));
    await flush();
    expect(replayed).toMatchObject([{ type: "change", cursor: { epoch, sequence: 2 } }]);
  });

  test("requires and accepts an initial snapshot boundary before live delivery", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: null }, (frame) => frames.push(frame));
    await flush();
    const snapshot = frames[0];
    if (!snapshot) {
      throw new Error("expected snapshot frame");
    }
    acknowledge(stream, subscription.subscriptionId, snapshot.cursor);
    stream.publish(event("1"));
    await flush();
    expect(frames).toMatchObject([
      { type: "snapshot_required", cursor: { epoch, sequence: 0 } },
      { type: "change", cursor: { epoch, sequence: 1 } },
    ]);
  });

  test("resends unacknowledged changes after reconnect", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: null }, (frame) => frames.push(frame));
    await flush();
    const snapshot = frames[0];
    if (!snapshot) {
      throw new Error("expected snapshot frame");
    }
    acknowledge(stream, subscription.subscriptionId, snapshot.cursor);
    subscription.unsubscribe();

    stream.publish(event("1"));
    const reconnected: TaskEventStreamFrame[] = [];
    stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => reconnected.push(frame));
    await flush();
    expect(reconnected).toMatchObject([{ type: "change", cursor: { epoch, sequence: 1 } }]);
  });

  test("requires a snapshot after an epoch mismatch or retained-buffer gap", async () => {
    const { stream } = createStream();
    const mismatch: TaskEventStreamFrame[] = [];
    stream.subscribe({ cursor: { epoch: otherEpoch, sequence: 4 } }, (frame) =>
      mismatch.push(frame),
    );
    for (let index = 1; index <= 257; index += 1) {
      stream.publish(event(String(index)));
    }
    const gap: TaskEventStreamFrame[] = [];
    stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => gap.push(frame));
    await flush();
    expect(mismatch).toMatchObject([
      { type: "snapshot_required", reason: "epoch_mismatch", cursor: { epoch, sequence: 0 } },
    ]);
    expect(gap).toMatchObject([
      { type: "snapshot_required", reason: "buffer_gap", cursor: { epoch, sequence: 257 } },
    ]);
  });

  test("rejects invalid acknowledgements while accepting the exact snapshot boundary", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: null }, (frame) => frames.push(frame));
    await flush();
    expect(() => acknowledge(stream, secondSubscriptionId, { epoch, sequence: 0 })).toThrow(
      "unknown subscription",
    );
    expect(() =>
      acknowledge(stream, subscription.subscriptionId, { epoch: otherEpoch, sequence: 0 }),
    ).toThrow("wrong epoch");
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 });
    stream.publish(event("1"));
    stream.publish(event("2"));
    await flush();

    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 2 })).toThrow(
      "skipped a frame",
    );
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 3 })).toThrow(
      "beyond delivered",
    );
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 });
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 })).toThrow(
      "regressed",
    );
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 });
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 2 });
  });

  test("does not let slow or throwing sinks block healthy delivery", async () => {
    const { failures, stream } = createStream();
    let slowCalled = false;
    const healthy: TaskEventStreamFrame[] = [];
    stream.subscribe({ cursor: { epoch, sequence: 0 } }, () => {
      slowCalled = true;
      const deadline = Date.now() + 15;
      while (Date.now() < deadline) {
        // Deliberately synchronous to prove publish itself does not wait for the sink.
      }
    });
    stream.subscribe({ cursor: { epoch, sequence: 0 } }, () => {
      throw new Error("sink failed");
    });
    const healthySubscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) =>
      healthy.push(frame),
    );

    stream.publish(event("1"));
    expect(slowCalled).toBe(false);
    await flush();
    expect(healthy).toMatchObject([{ type: "change", cursor: { epoch, sequence: 1 } }]);
    expect(failures).toHaveLength(1);
    acknowledge(stream, healthySubscription.subscriptionId, { epoch, sequence: 1 });
    stream.publish(event("2"));
    await flush();
    expect(healthy).toHaveLength(2);
    expect(failures).toHaveLength(1);
  });

  test("delivers immutable frames detached from the published event payload", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: null }, (frame) => frames.push(frame));
    await flush();
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 });
    const published: ExternalTaskSyncEvent = {
      eventId: "event-1",
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1"],
      removedTaskIds: [],
      emittedAt: "2026-04-10T13:00:00.000Z",
    };

    stream.publish(published);
    published.taskIds.push("task-2");
    await flush();
    const change = frames[1];
    expect(change).toMatchObject({ type: "change", cursor: { epoch, sequence: 1 } });
    if (change?.type !== "change" || change.event.kind !== "tasks_updated") {
      throw new Error("expected task update frame");
    }
    expect(change.event.taskIds).toEqual(["task-1"]);
    expect(Object.isFrozen(change)).toBe(true);
    expect(Object.isFrozen(change.cursor)).toBe(true);
    expect(Object.isFrozen(change.event)).toBe(true);
    expect(Object.isFrozen(change.event.taskIds)).toBe(true);
  });

  test("rejects task event identifiers with surrounding whitespace", () => {
    const { stream } = createStream();

    for (const invalidEvent of [
      { ...event("task-id"), taskId: " task-task-id " },
      { ...event("repo-path"), repoPath: " /repo" },
    ]) {
      expect(() => stream.publish(invalidEvent)).toThrow(
        "Task event stream requires a valid task event.",
      );
    }
  });

  test("publishes the schema-validated event payload", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: null }, (frame) => frames.push(frame));
    await flush();
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 });

    let repoPathReads = 0;
    const published = {
      eventId: "event-1",
      kind: "external_task_created" as const,
      get repoPath() {
        repoPathReads += 1;
        return repoPathReads === 1 ? "/validated-repo" : "/unchecked-repo";
      },
      taskId: "task-1",
      emittedAt: "2026-04-10T13:00:00.000Z",
    } as ExternalTaskSyncEvent;

    stream.publish(published);
    await flush();

    const change = frames[1];
    if (change?.type !== "change" || change.event.kind !== "external_task_created") {
      throw new Error("expected external task created change frame");
    }
    expect(change.event.repoPath).toBe("/validated-repo");
  });
});
