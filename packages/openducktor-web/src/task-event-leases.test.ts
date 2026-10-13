import { expect, mock, test } from "bun:test";
import type {
  TaskEventCursor,
  TaskEventStreamFrame,
  TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";

type Sink = (frame: TaskEventStreamFrame) => void | boolean;

const cursor = (sequence: number): TaskEventCursor => ({
  epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea",
  sequence,
});
const change = (sequence: number): Extract<TaskEventStreamFrame, { type: "change" }> => ({
  type: "change",
  cursor: cursor(sequence),
  event: {
    eventId: `event-${sequence}`,
    kind: "external_task_created",
    boardChanges: null,
    repoPath: "/repo",
    taskId: `task-${sequence}`,
    taskSnapshot: { id: `task-${sequence}`, title: "Task", status: "open" },
    emittedAt: "2026-07-23T12:00:00.000Z",
  },
});

const createFakeStream = () => {
  let sink: Sink = () => {};
  let unsubscribeCalls = 0;
  const acknowledge = mock((_input: { subscriptionId: string; cursor: TaskEventCursor }) => {});
  return {
    acknowledge,
    emit: (frame: TaskEventStreamFrame) => sink(frame),
    get unsubscribeCalls() {
      return unsubscribeCalls;
    },
    stream: {
      publish: () => cursor(0),
      subscribe: (_input: TaskEventStreamSubscribe, nextSink: Sink) => {
        sink = nextSink;
        return {
          subscriptionId: "host-subscription",
          resume: () => {},
          replay: () => {},
          replayBoundary: { epoch: "test-epoch", sequence: 0 },
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        };
      },
      acknowledge,
    },
  };
};

const createController = () => {
  const enqueued: Uint8Array[] = [];
  return {
    controller: {
      close: mock(() => {}),
      desiredSize: 1,
      enqueue: mock((value: Uint8Array) => {
        enqueued.push(value);
      }),
      error: mock(() => {}),
    } satisfies ReadableStreamDefaultController<Uint8Array>,
    enqueued,
  };
};

const createInactiveTimer = (): ReturnType<typeof setTimeout> => {
  const timer = setTimeout(() => {}, 0);
  clearTimeout(timer);
  return timer;
};

test("expires a created lease that never attaches and unsubscribes exactly once", () => {
  const fake = createFakeStream();
  const expiryCallbacks: Array<() => void> = [];
  const manager = createTaskEventLeaseManager({
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: () => {},
    scheduleExpiry: (callback) => {
      expiryCallbacks.push(callback);
      return createInactiveTimer();
    },
    taskEventStream: fake.stream,
  });

  const lease = manager.create({ cursor: null }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  expect(expiryCallbacks).toHaveLength(1);
  const expiryCallback = expiryCallbacks[0];
  if (!expiryCallback) throw new Error("Expected creation expiry timer.");
  expiryCallback();
  expiryCallback();

  expect(manager.get(lease.subscriptionId)).toBeUndefined();
  expect(fake.unsubscribeCalls).toBe(1);
});

test("cancels the creation expiry timer when an SSE connection attaches", () => {
  const fake = createFakeStream();
  const clearExpiryTimer = mock(() => {});
  const manager = createTaskEventLeaseManager({
    clearExpiryTimer,
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: () => {},
    scheduleExpiry: createInactiveTimer,
    taskEventStream: fake.stream,
  });
  const lease = manager.create({ cursor: null }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");

  manager.attach(lease, createController().controller);

  expect(clearExpiryTimer).toHaveBeenCalledTimes(1);
  expect(lease.expiryTimer).toBeNull();
  expect(fake.unsubscribeCalls).toBe(0);
});

test("clears the creation timer and unsubscribes once on explicit delete or shutdown", () => {
  const fake = createFakeStream();
  const clearExpiryTimer = mock(() => {});
  const manager = createTaskEventLeaseManager({
    clearExpiryTimer,
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: () => {},
    scheduleExpiry: createInactiveTimer,
    taskEventStream: fake.stream,
  });
  const deletedLease = manager.create({ cursor: null }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  const shutdownLease = manager.create({ cursor: null }, "1481b3fa-242a-4baf-a805-c6bc77a2496e");

  manager.delete(deletedLease);
  manager.delete(deletedLease);
  manager.dispose();

  expect(clearExpiryTimer).toHaveBeenCalledTimes(2);
  expect(fake.unsubscribeCalls).toBe(2);
  expect(manager.get(deletedLease.subscriptionId)).toBeUndefined();
  expect(manager.get(shutdownLease.subscriptionId)).toBeUndefined();
});

test("replays only unacknowledged frames and preserves late-cancel connection generations", async () => {
  const stream = createTaskEventStream({
    epochFactory: () => cursor(0).epoch,
    reporter: { report: () => {} },
  });
  const manager = createTaskEventLeaseManager({
    encodeFrame: (frame) => new TextEncoder().encode(JSON.stringify(frame)),
    reportDeliveryFailure: () => {},
    taskEventStream: stream,
  });
  const lease = manager.create({ cursor: cursor(0) }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  const first = createController();
  const firstGeneration = manager.attach(lease, first.controller);
  stream.publish(change(1).event);
  await Promise.resolve();
  expect(() => manager.acknowledge(lease, cursor(2))).toThrow();
  manager.acknowledge(lease, cursor(1));
  stream.publish(change(2).event);
  await Promise.resolve();
  const second = createController();
  const secondGeneration = manager.attach(lease, second.controller);
  manager.detach(lease, firstGeneration);
  await Promise.resolve();

  expect(first.enqueued.map((value) => JSON.parse(new TextDecoder().decode(value)))).toEqual([
    change(1),
    change(2),
  ]);
  expect(second.enqueued.map((value) => JSON.parse(new TextDecoder().decode(value)))).toEqual([
    change(2),
  ]);
  expect(lease.connection?.generation).toBe(secondGeneration);
  manager.dispose();
});

test("isolates enqueue failures and deletes host subscriptions on explicit disposal", () => {
  const fake = createFakeStream();
  const reported: unknown[] = [];
  const manager = createTaskEventLeaseManager({
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: ({ cause }) => reported.push(cause),
    taskEventStream: fake.stream,
  });
  const lease = manager.create({ cursor: cursor(0) }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  const failure = new Error("closed response");
  const brokenController = {
    close: mock(() => {}),
    desiredSize: 1,
    enqueue: mock(() => {
      throw failure;
    }),
    error: mock(() => {}),
  } satisfies ReadableStreamDefaultController<Uint8Array>;
  manager.attach(lease, brokenController);
  fake.emit(change(1));

  expect(reported).toEqual([failure]);
  expect(lease.connection).toBeNull();
  manager.dispose();
  expect(fake.unsubscribeCalls).toBe(1);
  expect(manager.get(lease.subscriptionId)).toBeUndefined();
});

test("cancels reconnect expiry and expires a detached lease exactly once", () => {
  const fake = createFakeStream();
  const expiryCallbacks: Array<() => void> = [];
  const clearExpiryTimer = mock(() => {});
  const manager = createTaskEventLeaseManager({
    clearExpiryTimer,
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: () => {},
    scheduleExpiry: (callback) => {
      expiryCallbacks.push(callback);
      return createInactiveTimer();
    },
    taskEventStream: fake.stream,
  });
  const lease = manager.create({ cursor: null }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  const first = createController();
  const firstGeneration = manager.attach(lease, first.controller);
  manager.detach(lease, firstGeneration);
  const second = createController();
  const secondGeneration = manager.attach(lease, second.controller);
  manager.detach(lease, secondGeneration);

  expect(clearExpiryTimer).toHaveBeenCalledTimes(2);
  const expiryCallback = expiryCallbacks.at(-1);
  if (!expiryCallback) throw new Error("Expected detached lease expiry timer.");
  expiryCallback();
  expiryCallback();
  expect(manager.get(lease.subscriptionId)).toBeUndefined();
  expect(fake.unsubscribeCalls).toBe(1);
});
