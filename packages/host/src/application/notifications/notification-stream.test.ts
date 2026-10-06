import { Effect, Fiber, Stream } from "effect";
import { afterEach, expect, test } from "bun:test";
import {
  createDefaultNotificationSettings,
  type NotificationStreamFrame,
  type SelectedNotification,
} from "@openducktor/contracts";
import { createControlledScheduler } from "../../effect/test-support/controlled-scheduler";
import { createNotificationStream } from "./notification-stream";
const selected = (id: string): SelectedNotification => ({
  occurrence: {
    occurrenceId: id,
    kind: "workflow.closed",
    repoPath: "/repo",
    repositoryLabel: "Repo",
    status: "Closed",
    navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task" },
  },
  settings: createDefaultNotificationSettings(),
  preferenceRevision: 1,
});
// Effect v4 runs each scheduled fiber step in a setImmediate callback. A frame passes through
// several fibers before it reaches a listener, so wait a fixed number of event-loop turns.
const flush = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
};
test("two subscribers share selections; new attachment is silent and reconnect replays original preferences", async () => {
  const stream = watchStream();
  const first: NotificationStreamFrame[] = [];
  const second: NotificationStreamFrame[] = [];
  const fail = (cause: unknown) => {
    throw cause;
  };
  const stop = stream.subscribe({ cursor: null }, (frame) => first.push(frame), fail);
  stream.subscribe({ cursor: null }, (frame) => second.push(frame), fail);
  await flush();
  const saved = selected("first");
  stream.publishOccurrence(saved);
  await flush();
  expect(first).toEqual(second);
  const boundary = first.at(-1)?.cursor;
  expect(boundary).toBeDefined();
  stop();
  const retained = selected("retained");
  stream.publishOccurrence(retained);
  retained.settings.volumePercent = 0;
  const reconnected: NotificationStreamFrame[] = [];
  stream.subscribe({ cursor: boundary ?? null }, (frame) => reconnected.push(frame), fail);
  const fresh: NotificationStreamFrame[] = [];
  stream.subscribe({ cursor: null }, (frame) => fresh.push(frame), fail);
  await flush();
  expect(reconnected[0]).toMatchObject({ reason: "replay" });
  expect(reconnected[1]).toMatchObject({
    selected: { occurrence: { occurrenceId: "retained" }, settings: { volumePercent: 30 } },
  });
  expect(fresh).toHaveLength(1);
});
test("retention gaps and changed epochs attach at the current boundary with scoped health", async () => {
  const stream = watchStream();
  const first: NotificationStreamFrame[] = [];
  const stop = stream.subscribe(
    { cursor: null },
    (frame) => first.push(frame),
    () => {},
  );
  await flush();
  stop();
  for (let index = 0; index < 257; index++) stream.publishOccurrence(selected(String(index)));
  stream.publishHealth({
    scope: "/failed",
    source: "session",
    message: "Runtime observation failed. Restart the host.",
  });
  const frames: NotificationStreamFrame[] = [];
  stream.subscribe(
    { cursor: first[0]?.cursor ?? null },
    (frame) => frames.push(frame),
    () => {},
  );
  await flush();
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({
    reason: "gap",
    cursor: { sequence: 258 },
    health: [{ scope: "/failed" }],
  });
  const restarted: NotificationStreamFrame[] = [];
  stream.subscribe(
    { cursor: { epoch: crypto.randomUUID(), sequence: 1 } },
    (frame) => restarted.push(frame),
    () => {},
  );
  await flush();
  expect(restarted[0]).toMatchObject({ reason: "epoch_changed" });
});
test("a subscriber that exceeds its bounded queue fails instead of losing frames silently", async () => {
  const stream = watchStream();
  const failures: unknown[] = [];
  let report = () => {};
  const failed = new Promise<void>((resolve) => {
    report = resolve;
  });
  stream.subscribe(
    { cursor: null },
    () => {},
    (cause) => {
      failures.push(cause);
      report();
    },
  );
  await flush();
  for (let index = 0; index < 259; index++) stream.publishOccurrence(selected(String(index)));
  await failed;
  expect(failures).toHaveLength(1);
  expect(String(failures[0])).toContain("cannot keep up");
});

test("a full reconnect replay leaves room for live frames before delivery starts", async () => {
  const stream = createNotificationStream();
  const attached = await Effect.runPromise(stream.subscribe({ cursor: null }).pipe(Stream.runHead));
  expect(attached._tag).toBe("Some");
  if (attached._tag !== "Some") throw new Error("Missing attachment");
  for (let index = 0; index < 256; index++) stream.publishOccurrence(selected(String(index)));
  const frames: NotificationStreamFrame[] = [];
  const controlled = createControlledScheduler();
  const fiber = Effect.runFork(
    stream.subscribe({ cursor: attached.value.cursor }).pipe(
      Stream.take(259),
      Stream.runForEach((frame) => Effect.sync(() => frames.push(frame))),
    ),
    { scheduler: controlled.scheduler },
  );
  try {
    // Pause delivery while the native event source continues to publish.
    controlled.step();
    expect(frames).toEqual([]);
    stream.publishOccurrence(selected("first-live"));
    stream.publishOccurrence(selected("second-live"));
    controlled.release();
    await Effect.runPromise(Fiber.join(fiber).pipe(Effect.timeout("500 millis")));
    expect(frames[0]).toMatchObject({ type: "attached", reason: "replay" });
    expect(frames.map((frame) => frame.cursor.sequence)).toEqual(
      Array.from({ length: 259 }, (_, index) => index),
    );
    expect(frames.slice(-2)).toMatchObject([
      { selected: { occurrence: { occurrenceId: "first-live" } } },
      { selected: { occurrence: { occurrenceId: "second-live" } } },
    ]);
  } finally {
    controlled.release();
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(stream.dispose());
  }
});

test("shutdown ends both subscriptions and rejects new readers", async () => {
  const stream = createNotificationStream();
  const read = () =>
    Effect.runFork(stream.subscribe({ cursor: null }).pipe(Stream.take(2), Stream.runCollect));
  const first = read();
  const second = read();
  await flush();
  await Effect.runPromise(stream.dispose());
  for (const fiber of [first, second]) {
    const result = await Effect.runPromise(Fiber.await(fiber));
    expect(result._tag).toBe("Failure");
    expect(String(result)).toContain("Notification host stopped");
  }
  await expect(
    Effect.runPromise(stream.subscribe({ cursor: null }).pipe(Stream.runHead)),
  ).rejects.toThrow("Notification host stopped");
});

test("a failed listener releases its queue while another listener keeps receiving", async () => {
  const stream = watchStream();
  const frames: NotificationStreamFrame[] = [];
  const failures: unknown[] = [];
  const stop = stream.subscribe(
    { cursor: null },
    (frame) => frames.push(frame),
    () => {},
  );
  stream.subscribe(
    { cursor: null },
    () => {
      throw new Error("Renderer closed");
    },
    (cause) => failures.push(cause),
  );
  await flush();
  stream.publishOccurrence(selected("next"));
  await flush();
  expect(frames).toHaveLength(2);
  expect(failures).toHaveLength(1);
  expect(String(failures[0])).toContain("Renderer closed");
  stop();
  stream.publishOccurrence(selected("after-stop"));
  await flush();
  expect(frames).toHaveLength(2);
});

const streams: ReturnType<typeof createNotificationStream>[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) await Effect.runPromise(stream.dispose());
});
const watchStream = () => {
  const stream = createNotificationStream();
  streams.push(stream);
  return {
    ...stream,
    subscribe(
      input: Parameters<typeof stream.subscribe>[0],
      onFrame: (frame: NotificationStreamFrame) => void,
      onFailure: (cause: unknown) => void,
    ) {
      const fiber = Effect.runFork(
        stream.subscribe(input).pipe(
          Stream.runForEach((frame) =>
            Effect.try({ try: () => onFrame(frame), catch: (cause) => cause }),
          ),
          Effect.catch((cause) => Effect.sync(() => onFailure(cause))),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
  };
};
