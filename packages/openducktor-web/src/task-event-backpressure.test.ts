import { createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import { taskEventStreamFrameSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { task } from "../../host/src/application/tasks/sync/task-sync-service.test-support";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";
import { routeTaskEventHttpRequest } from "./task-event-http-server";
import { writeTaskFrameSseEvent } from "@openducktor/remote-host/task-event-sse";

const epoch = "fc49d1f9-708c-4198-b56b-f1437b2bbcea";
const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";

const createHarness = () => {
  const failures: unknown[] = [];
  const stream = createTaskEventStream({
    epochFactory: () => epoch,
    reporter: { report: (failure) => failures.push(failure) },
  });
  const counts = { encodedFrames: 0, encodedBytes: 0 };
  const manager = createTaskEventLeaseManager({
    taskEventStream: stream,
    reportDeliveryFailure: ({ cause }) => failures.push(cause),
    encodeFrame: (frame) => {
      const encoded = writeTaskFrameSseEvent(frame);
      counts.encodedFrames += 1;
      counts.encodedBytes += encoded.byteLength;
      return encoded;
    },
  });
  const lease = manager.create({ cursor: { epoch, sequence: 0 } }, subscriptionId);
  const token = createHmac("sha256", "control-token")
    .update(`task-event-stream:v1:${subscriptionId}`)
    .digest("base64url");
  const connect = async () => {
    const response = await Effect.runPromise(
      routeTaskEventHttpRequest({
        appToken: "app-token",
        controlToken: "control-token",
        corsHeaders: {},
        parseJsonObjectBody: () => Effect.succeed({}),
        request: new Request(
          `http://localhost/task-events/subscriptions/${subscriptionId}/stream?token=${token}`,
        ),
        shutdownStarted: false,
        taskEventLeaseManager: manager,
        validateAppCookieOrHeader: () => Effect.void,
        validateAppSessionCookie: () => Effect.void,
      }),
    );
    if (!response?.body) throw new Error("Expected SSE response body.");
    const reader = response.body.getReader();
    await reader.read(); // Consume the readiness comment, then stop reading task frames.
    return reader;
  };
  const publish = (sequence: number, descriptionBytes: number) => {
    stream.publish({
      eventId: `event-${sequence}`,
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1"],
      removedTaskIds: [],
      taskSnapshots: [{ id: "task-1", title: `Task ${sequence}`, status: "open" }],
      statusChanges: [],
      emittedAt: "2026-10-11T17:00:00.000Z",
      boardChanges: {
        documentChanges: [],
        cards: [task({ description: "x".repeat(descriptionBytes), title: `Task ${sequence}` })],
        doneVisibleDays: 1,
      },
    });
  };
  return { connect, counts, failures, lease, manager, publish };
};

const readFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const result = await reader.read();
  const data = new TextDecoder()
    .decode(result.value)
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!data) throw new Error("Expected SSE task frame.");
  return taskEventStreamFrameSchema.parse(JSON.parse(data.slice(6)));
};

// Serialize 300 complete cards to exercise both frame and byte retention limits.
test.each([
  { detached: false, descriptionBytes: 0, boundary: 258 },
  { detached: true, descriptionBytes: 0, boundary: 258 },
  { detached: false, descriptionBytes: 64 * 1024, boundary: 130 },
  { detached: true, descriptionBytes: 64 * 1024, boundary: 130 },
])(
  "bounds stalled SSE delivery and recovers: %j",
  async ({ detached, descriptionBytes, boundary }) => {
    const { connect, counts, failures, lease, manager, publish } = createHarness();
    let reader = await connect();
    try {
      if (detached) await reader.cancel();
      for (let sequence = 1; sequence <= 300; sequence += 1) {
        publish(sequence, descriptionBytes);
        await Promise.resolve();
      }
      expect(counts.encodedFrames).toBeLessThanOrEqual(1);
      expect(counts.encodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024 + 128);
      if (detached) reader = await connect();
      else expect(lease.connection?.controller.desiredSize).toBe(0);
      let frame = await readFrame(reader);
      if (frame.type === "change") frame = await readFrame(reader);
      expect(frame.type).toBe("snapshot_required");
      expect(frame.cursor.sequence).toBeLessThanOrEqual(boundary);
      manager.acknowledge(lease, frame.cursor);
      if (descriptionBytes > 0) {
        const latest = await readFrame(reader);
        expect(latest).toMatchObject({
          type: "snapshot_required",
          cursor: { epoch, sequence: 300 },
        });
        manager.acknowledge(lease, latest.cursor);
      } else {
        for (let sequence = frame.cursor.sequence + 1; sequence <= 300; sequence += 1) {
          expect(await readFrame(reader)).toMatchObject({
            type: "change",
            cursor: { epoch, sequence },
          });
        }
        manager.acknowledge(lease, { epoch, sequence: 300 });
      }
      publish(301, 0);
      expect(await readFrame(reader)).toMatchObject({
        type: "change",
        cursor: { epoch, sequence: 301 },
      });
      expect(failures).toEqual([]);
    } finally {
      await reader.cancel();
      manager.dispose();
    }
  },
  5_000,
);

test("continues ordered SSE delivery without snapshots while cumulative acknowledgement is delayed", async () => {
  const { connect, failures, lease, manager, publish } = createHarness();
  const reader = await connect();
  try {
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      publish(sequence, 64 * 1024);
      expect(await readFrame(reader)).toMatchObject({
        type: "change",
        cursor: { epoch, sequence },
      });
    }
    manager.acknowledge(lease, { epoch, sequence: 300 });
    expect(failures).toEqual([]);
  } finally {
    await reader.cancel();
    manager.dispose();
  }
}, 5_000);
