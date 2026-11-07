import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { expect, test } from "bun:test";
import {
  taskEventLeaseSchema,
  type TaskEventCursor,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import { task } from "../../host/src/application/tasks/sync/task-sync-service.test-support";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { BufferedHostEventStream } from "@openducktor/remote-host/host-event-bus";
import type { HostChannelOptions } from "@openducktor/remote-host/host-channel";
import {
  createFakeChannelSocket,
  type FakeChannelSocket,
} from "@openducktor/remote-host/host-channel.test-support";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";

const epoch = "fc49d1f9-708c-4198-b56b-f1437b2bbcea";
/** The host channel pauses task frames while the socket buffers this many bytes. */
const TASK_FRAME_BUFFER_BYTES = 1024 * 1024;

const createHarness = () => {
  const failures: unknown[] = [];
  const stream = createTaskEventStream({
    epochFactory: () => epoch,
    reporter: { report: (failure) => failures.push(failure) },
  });
  const manager = createTaskEventLeaseManager({
    taskEventStream: stream,
    reportDeliveryFailure: ({ cause }) => failures.push(cause),
  });
  const options: HostChannelOptions = {
    hostEvents: new BufferedHostEventStream(),
    notifications: createNotificationStream(),
    leases: manager,
    ownedLeases: new Set(),
    invoke: async () => ({ result: null }),
    refusal: () => null,
    reportFailure: (cause) => failures.push(cause),
  };
  const publish = (sequence: number, descriptionBytes: number) => {
    stream.publish({
      eventId: `event-${sequence}`,
      kind: "tasks_updated",
      workspaceId: "repo",
      repoPath: "/repo",
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [
        {
          workflow: specPlanBuildWorkflow.reference,
          id: "task-1",
          title: `Task ${sequence}`,
          status: "open",
        },
      ],
      statusChanges: [],
      emittedAt: "2026-10-11T17:00:00.000Z",
      boardChanges: {
        artifactChanges: [],
        cards: [task({ description: "x".repeat(descriptionBytes), title: `Task ${sequence}` })],
        doneVisibleDays: 1,
      },
    });
  };
  return { failures, manager, options, publish };
};

const taskFrames = (socket: FakeChannelSocket): TaskEventStreamFrame[] =>
  socket.ofType("task_frame").map(({ header }) => header.frame);

/** Reads and acknowledges frames until the client applied `last`, as a client does. */
/** The host stream delivers frames in a microtask. */
const delivered = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const drainTo = async (socket: FakeChannelSocket, subscriptionId: string, last: number) => {
  const applied: TaskEventStreamFrame[] = [];
  let read = 0;
  for (let round = 0; round < 1000; round += 1) {
    socket.flush();
    await delivered();
    const frames = taskFrames(socket).slice(read);
    read += frames.length;
    applied.push(...frames);
    const cursor: TaskEventCursor | undefined = frames.at(-1)?.cursor;
    if (cursor) socket.request({ method: "task_events.ack", subscriptionId, cursor });
    if (cursor?.sequence === last) return applied;
    await delivered();
  }
  throw new Error(`Delivery did not reach sequence ${last}.`);
};

// Serialize 300 complete cards to exercise both frame and byte retention limits.
test.each([
  { detached: false, descriptionBytes: 0 },
  { detached: true, descriptionBytes: 0 },
  { detached: false, descriptionBytes: 64 * 1024 },
  { detached: true, descriptionBytes: 64 * 1024 },
])("bounds stalled channel delivery and recovers: %j", async ({ detached, descriptionBytes }) => {
  const { failures, manager, options, publish } = createHarness();
  let socket = createFakeChannelSocket(options);
  try {
    const subscribe = socket.request({
      method: "task_events.subscribe",
      input: { cursor: { epoch, sequence: 0 } },
    });
    const { subscriptionId } = taskEventLeaseSchema.parse(socket.result(subscribe));
    socket.stall();
    if (detached) socket.disconnect();
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      publish(sequence, descriptionBytes);
      await delivered();
    }

    const stalledBytes = socket
      .ofType("task_frame")
      .reduce((total, { header }) => total + JSON.stringify(header).length, 0);
    if (detached) expect(stalledBytes).toBe(0);
    else expect(stalledBytes).toBeLessThanOrEqual(TASK_FRAME_BUFFER_BYTES + 128 * 1024);

    if (detached) {
      socket = createFakeChannelSocket(options);
      socket.request({ method: "task_events.attach", subscriptionId });
    }
    const stalledFrames = taskFrames(socket).length;
    const applied = (await drainTo(socket, subscriptionId, 300)).slice(stalledFrames);
    // 300 small frames fit in the socket buffer. Other cases overflow host retention.
    if (detached || descriptionBytes > 0) {
      expect(stalledFrames).toBeLessThan(300);
      expect(applied[0]?.type).toBe("snapshot_required");
    } else expect(stalledFrames).toBe(300);
    // After the stall, the client gets each change in order or one snapshot for a gap.
    let expected = (applied[0]?.cursor.sequence ?? 1) - 1;
    for (const frame of applied) {
      if (frame.type === "change") expect(frame.cursor.sequence).toBe(expected + 1);
      expect(frame.cursor.sequence).toBeGreaterThan(expected);
      expected = frame.cursor.sequence;
    }
    publish(301, 0);
    socket.flush();
    await delivered();
    expect(taskFrames(socket).at(-1)).toMatchObject({
      type: "change",
      cursor: { epoch, sequence: 301 },
    });
    expect(failures).toEqual([]);
  } finally {
    manager.dispose();
  }
});

test("keeps ordered channel delivery without snapshots while acknowledgement is delayed", async () => {
  const { failures, manager, options, publish } = createHarness();
  const socket = createFakeChannelSocket(options);
  try {
    const subscribe = socket.request({
      method: "task_events.subscribe",
      input: { cursor: { epoch, sequence: 0 } },
    });
    const { subscriptionId } = taskEventLeaseSchema.parse(socket.result(subscribe));
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      publish(sequence, 64 * 1024);
      await delivered();
    }

    expect(taskFrames(socket).map((frame) => [frame.type, frame.cursor.sequence])).toEqual(
      Array.from({ length: 300 }, (_, index) => ["change", index + 1]),
    );
    socket.request({
      method: "task_events.ack",
      subscriptionId,
      cursor: { epoch, sequence: 300 },
    });
    expect(failures).toEqual([]);
  } finally {
    manager.dispose();
  }
});
