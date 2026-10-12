import { task } from "../application/tasks/sync/task-sync-service.test-support";
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

const event = (id: string): Extract<ExternalTaskSyncEvent, { kind: "external_task_created" }> => ({
  eventId: `event-${id}`,
  kind: "external_task_created",
  boardChanges: null,
  repoPath: "/repo",
  taskId: `task-${id}`,
  taskSnapshot: { id: `task-${id}`, title: "Task", status: "open" },
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
  test("recovers a future subscription cursor through its delivered snapshot boundary", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 1 } }, (frame) =>
      frames.push(frame),
    );
    await flush();
    expect(frames).toMatchObject([
      { type: "snapshot_required", cursor: { epoch, sequence: 0 }, reason: "buffer_gap" },
    ]);
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 });
    stream.publish(event("1"));
    await flush();
    expect(frames[1]).toMatchObject({ type: "change", cursor: { epoch, sequence: 1 } });
    subscription.unsubscribe();
  });

  test("refused frames stay undelivered until an explicit resume", async () => {
    const { stream } = createStream();
    let accepting = false;
    let attempts = 0;
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      attempts += 1;
      if (!accepting) return false;
      frames.push(frame);
    });
    stream.publish(event("1"));
    await flush();
    expect(attempts).toBe(1);
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 })).toThrow(
      "beyond delivered frames",
    );
    await flush();
    expect(attempts).toBe(1);
    accepting = true;
    subscription.resume();
    subscription.resume();
    await flush();
    expect(frames).toMatchObject([{ type: "change", cursor: { epoch, sequence: 1 } }]);
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 });
    subscription.unsubscribe();
  });

  test("an in-flight acknowledgement removes replayed prefixes without regressing delivery", async () => {
    const { stream } = createStream();
    let accepting = true;
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      if (!accepting) return false;
      frames.push(frame);
    });
    stream.publish(event("1"));
    stream.publish(event("2"));
    await flush();
    accepting = false;
    subscription.replay();
    await flush();
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 2 });
    accepting = true;
    subscription.resume();
    stream.publish(event("3"));
    await flush();
    expect(frames.map((frame) => frame.cursor.sequence)).toEqual([1, 2, 3]);
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 3 });
    subscription.unsubscribe();
  });

  test("a paused subscriber's gap does not interrupt another subscriber's ordered delivery", async () => {
    const { failures, stream } = createStream();
    let accepting = false;
    const pausedFrames: TaskEventStreamFrame[] = [];
    const paused = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      if (!accepting) return false;
      pausedFrames.push(frame);
    });
    const healthyFrames: TaskEventStreamFrame[] = [];
    const healthy = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) => {
      healthyFrames.push(frame);
    });
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      stream.publish(event(String(sequence)));
      await flush();
    }
    expect(healthyFrames.map((frame) => frame.cursor.sequence)).toEqual(
      Array.from({ length: 300 }, (_, index) => index + 1),
    );
    acknowledge(stream, healthy.subscriptionId, { epoch, sequence: 300 });
    accepting = true;
    paused.resume();
    await flush();
    expect(pausedFrames).toMatchObject([
      { type: "snapshot_required", cursor: { epoch, sequence: 257 }, reason: "buffer_gap" },
    ]);
    acknowledge(stream, paused.subscriptionId, { epoch, sequence: 257 });
    await flush();
    expect(pausedFrames.at(-1)?.cursor.sequence).toBe(300);
    expect(failures).toEqual([]);
    paused.unsubscribe();
    healthy.unsubscribe();
  });

  test("protects created task snapshots across subscribers and replay", async () => {
    const { stream } = createStream();
    const received: TaskEventStreamFrame[] = [];
    const mutationResults: boolean[] = [];
    const first = stream.subscribe({ cursor: null }, (frame) => {
      if (frame.type === "change" && frame.event.kind === "external_task_created") {
        mutationResults.push(Reflect.set(frame.event.taskSnapshot, "title", "Changed by sink"));
        mutationResults.push(Reflect.set(frame.event.taskSnapshot, "status", "closed"));
      }
    });
    const second = stream.subscribe({ cursor: null }, (frame) => {
      if (frame.type === "change") received.push(frame);
    });
    await flush();
    acknowledge(stream, first.subscriptionId, { epoch, sequence: 0 });
    acknowledge(stream, second.subscriptionId, { epoch, sequence: 0 });

    const published = event("1");
    stream.publish(published);
    if (published.kind !== "external_task_created") throw new Error("Expected created task");
    published.taskSnapshot.title = "Changed by publisher";
    await flush();
    const replayed = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) =>
      received.push(frame),
    );
    await flush();

    expect(mutationResults).toEqual([false, false]);
    expect(received).toHaveLength(2);
    for (const frame of received) {
      expect(frame).toMatchObject({
        type: "change",
        event: { taskSnapshot: { id: "task-1", title: "Task", status: "open" } },
      });
    }
    first.unsubscribe();
    second.unsubscribe();
    replayed.unsubscribe();
  });

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

  test("requires a snapshot when a card exceeds the retained byte budget", async () => {
    const { stream } = createStream();
    const frames: TaskEventStreamFrame[] = [];
    const subscription = stream.subscribe({ cursor: { epoch, sequence: 0 } }, (frame) =>
      frames.push(frame),
    );
    const large = event("large");
    stream.publish({
      ...large,
      boardChanges: {
        documentChanges: [],
        cards: [
          task({ id: large.taskId, title: "Task", description: "x".repeat(8 * 1024 * 1024) }),
        ],
        doneVisibleDays: 1,
      },
    });
    await flush();
    expect(frames).toMatchObject([
      { type: "snapshot_required", cursor: { epoch, sequence: 1 }, reason: "buffer_gap" },
    ]);
    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 });
    stream.publish(event("small"));
    await flush();
    expect(frames[1]).toMatchObject({ type: "change", cursor: { epoch, sequence: 2 } });
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

    acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 2 });
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 3 })).toThrow(
      "beyond delivered",
    );
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 0 })).toThrow(
      "regressed",
    );
    expect(() => acknowledge(stream, subscription.subscriptionId, { epoch, sequence: 1 })).toThrow(
      "regressed",
    );
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
      boardChanges: null,
      repoPath: "/repo",
      taskIds: ["task-1"],
      removedTaskIds: [],
      statusChanges: [
        {
          previousStatus: "open",
          task: { id: "task-1", title: "Committed title", status: "spec_ready" },
        },
      ],
      taskSnapshots: [{ id: "task-1", title: "Task 1", status: "open" }],
      emittedAt: "2026-04-10T13:00:00.000Z",
    };

    stream.publish(published);
    if (published.kind !== "tasks_updated") throw new Error("expected task update event");
    published.taskIds.push("task-2");
    const publishedSnapshot = published.taskSnapshots[0];
    if (!publishedSnapshot) throw new Error("expected task snapshot");
    publishedSnapshot.title = "Changed after publication";
    const publishedStatusChange = published.statusChanges[0];
    if (!publishedStatusChange) throw new Error("expected status change");
    publishedStatusChange.task.title = "Changed after publication";
    await flush();
    const change = frames[1];
    expect(change).toMatchObject({ type: "change", cursor: { epoch, sequence: 1 } });
    if (change?.type !== "change" || change.event.kind !== "tasks_updated") {
      throw new Error("expected task update frame");
    }
    expect(change.event.taskIds).toEqual(["task-1"]);
    expect(change.event.taskSnapshots).toEqual([{ id: "task-1", title: "Task 1", status: "open" }]);
    expect(Object.isFrozen(change)).toBe(true);
    expect(Object.isFrozen(change.cursor)).toBe(true);
    expect(Object.isFrozen(change.event)).toBe(true);
    expect(Object.isFrozen(change.event.taskIds)).toBe(true);
    expect(Object.isFrozen(change.event.taskSnapshots)).toBe(true);
    expect(Object.isFrozen(change.event.taskSnapshots[0])).toBe(true);
    expect(change.event.statusChanges).toEqual([
      {
        previousStatus: "open",
        task: { id: "task-1", title: "Committed title", status: "spec_ready" },
      },
    ]);
    expect(Object.isFrozen(change.event.statusChanges)).toBe(true);
    expect(Object.isFrozen(change.event.statusChanges[0])).toBe(true);
    expect(Object.isFrozen(change.event.statusChanges[0]?.task)).toBe(true);
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
    const published: ExternalTaskSyncEvent = {
      eventId: "event-1",
      kind: "external_task_created" as const,
      boardChanges: null,
      get repoPath() {
        repoPathReads += 1;
        return repoPathReads === 1 ? "/validated-repo" : "/unchecked-repo";
      },
      taskId: "task-1",
      taskSnapshot: { id: "task-1", title: "Task", status: "open" },
      emittedAt: "2026-04-10T13:00:00.000Z",
    };

    stream.publish(published);
    await flush();

    const change = frames[1];
    if (change?.type !== "change" || change.event.kind !== "external_task_created") {
      throw new Error("expected external task created change frame");
    }
    expect(change.event.repoPath).toBe("/validated-repo");
  });
});
