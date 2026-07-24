import { expect, mock, test } from "bun:test";
import type {
  TaskEventCursor,
  TaskEventStreamFrame,
  TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import { createTaskEventLeaseManager } from "./task-event-leases";

type Sink = (frame: TaskEventStreamFrame) => void;

const cursor = (sequence: number): TaskEventCursor => ({
  epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea",
  sequence,
});
const change = (sequence: number): TaskEventStreamFrame => ({
  type: "change",
  cursor: cursor(sequence),
  event: {
    eventId: `event-${sequence}`,
    kind: "external_task_created",
    repoPath: "/repo",
    taskId: `task-${sequence}`,
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
      publish: () => {},
      subscribe: (_input: TaskEventStreamSubscribe, nextSink: Sink) => {
        sink = nextSink;
        return {
          subscriptionId: "host-subscription",
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
      enqueue: mock((value: Uint8Array) => enqueued.push(value)),
    } as unknown as ReadableStreamDefaultController<Uint8Array>,
    enqueued,
  };
};

test("expires a created lease that never attaches and unsubscribes exactly once", () => {
  const fake = createFakeStream();
  const expiryCallbacks: Array<() => void> = [];
  const manager = createTaskEventLeaseManager({
    encodeFrame: () => new Uint8Array(),
    reportDeliveryFailure: () => {},
    scheduleExpiry: (callback) => {
      expiryCallbacks.push(callback);
      return {} as ReturnType<typeof setTimeout>;
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
    scheduleExpiry: () => ({}) as ReturnType<typeof setTimeout>,
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
    scheduleExpiry: () => ({}) as ReturnType<typeof setTimeout>,
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

test("replays only unacknowledged frames and preserves late-cancel connection generations", () => {
  const fake = createFakeStream();
  const manager = createTaskEventLeaseManager({
    encodeFrame: (frame) => new TextEncoder().encode(JSON.stringify(frame)),
    reportDeliveryFailure: () => {},
    taskEventStream: fake.stream,
  });
  const lease = manager.create({ cursor: cursor(0) }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  const first = createController();
  const firstGeneration = manager.attach(lease, first.controller);
  fake.emit(change(1));
  manager.acknowledge(lease, cursor(1));
  fake.emit(change(2));
  const second = createController();
  const secondGeneration = manager.attach(lease, second.controller);
  manager.detach(lease, firstGeneration);

  expect(first.enqueued.map((value) => JSON.parse(new TextDecoder().decode(value)))).toEqual([
    change(1),
    change(2),
  ]);
  expect(second.enqueued.map((value) => JSON.parse(new TextDecoder().decode(value)))).toEqual([
    change(2),
  ]);
  expect(lease.connection?.generation).toBe(secondGeneration);
  expect(fake.acknowledge).toHaveBeenCalledWith({
    cursor: cursor(1),
    subscriptionId: "host-subscription",
  });
});

test("does not prune a lease when host acknowledgement rejects and snapshot boundaries replace changes", () => {
  const fake = createFakeStream();
  const manager = createTaskEventLeaseManager({
    encodeFrame: (frame) => new TextEncoder().encode(JSON.stringify(frame)),
    reportDeliveryFailure: () => {},
    taskEventStream: fake.stream,
  });
  const lease = manager.create({ cursor: cursor(0) }, "05e77c20-ebf2-4e7f-a880-9c95c24627ee");
  fake.emit(change(1));
  fake.acknowledge.mockImplementationOnce(() => {
    throw new Error("host rejected acknowledgement");
  });

  expect(() => manager.acknowledge(lease, cursor(1))).toThrow("host rejected acknowledgement");
  expect(lease.pendingFrames).toEqual([change(1)]);

  const snapshot: TaskEventStreamFrame = {
    type: "snapshot_required",
    cursor: cursor(2),
    reason: "buffer_gap",
  };
  fake.emit(snapshot);
  expect(lease.pendingFrames).toEqual([snapshot]);
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
    enqueue: mock(() => {
      throw failure;
    }),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  manager.attach(lease, brokenController);
  fake.emit(change(1));

  expect(reported).toEqual([failure]);
  expect(lease.connection).toBeNull();
  expect(lease.pendingFrames).toEqual([change(1)]);
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
      return {} as ReturnType<typeof setTimeout>;
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
