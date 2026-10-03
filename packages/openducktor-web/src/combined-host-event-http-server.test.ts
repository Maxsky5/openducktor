import { expect, mock, spyOn, test } from "bun:test";
import { Deferred, Effect, Stream } from "effect";
import { browserEventCursorSchema, hostReplayBoundarySchema } from "@openducktor/contracts";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { BufferedHostEventStream } from "./typescript-host-backend-support";
import { createCombinedHostSseResponse } from "./combined-host-event-http-server";

const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
const readCursor = (text: string) => {
  const id = text.split("\n").find((line) => line.startsWith("id: "));
  if (!id) throw new Error("Expected an SSE cursor");
  return browserEventCursorSchema.parse(JSON.parse(id.slice(4)));
};
const readBoundary = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: "replay-start" | "replay-complete",
) => {
  const frame = decode((await reader.read()).value);
  expect(frame).toContain(`event: ${eventName}`);
  const data = frame.split("\n").find((line) => line.startsWith("data: "));
  if (!data) throw new Error("Expected a replay boundary");
  return hostReplayBoundarySchema.parse(JSON.parse(data.slice(6)));
};

test("one response carries host and notification frames with independent resume cursors", async () => {
  const host = new BufferedHostEventStream(256);
  const notifications = createNotificationStream();
  const failures = mock(() => {});
  const hostStop = mock(() => {});
  const subscribeHost = host.subscribe.bind(host);
  spyOn(host, "subscribe").mockImplementation((listener) => {
    const stop = subscribeHost(listener);
    return () => {
      hostStop();
      stop();
    };
  });
  const response = await Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events?notifications=1"),
      host,
      notifications,
      {},
      failures,
    ),
  );
  const reader = response.body!.getReader();
  expect(decode((await reader.read()).value)).toContain(": openducktor-ready");
  await readBoundary(reader, "replay-start");
  expect(await readBoundary(reader, "replay-complete")).toEqual({
    hostEpoch: host.hostEpoch,
    sequence: 0,
    hostChanged: false,
    losses: [],
  });
  const initial = readCursor(decode((await reader.read()).value));
  expect(initial.hostEpoch).toBe(host.hostEpoch);
  expect(initial.hostEventId).toBe(0);
  expect(initial.notificationCursor?.sequence).toBe(0);
  if (!initial.notificationCursor) throw new Error("Expected an attached notification cursor");
  host.emit({ channel: "openducktor://run-event", payload: { type: "run" } }, failures);
  const hostFrame = decode((await reader.read()).value);
  expect(hostFrame).toContain("event: message");
  expect(readCursor(hostFrame)).toEqual({ ...initial, hostEventId: 1 });
  notifications.publishHealth({ scope: "/repo", source: "session", message: null });
  const notificationFrame = decode((await reader.read()).value);
  expect(notificationFrame).toContain("event: notification-frame");
  expect(readCursor(notificationFrame)).toEqual({
    hostEpoch: host.hostEpoch,
    hostEventId: 1,
    notificationCursor: { ...initial.notificationCursor, sequence: 1 },
  });

  const resumed = await Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events?notifications=1&notificationCursor=invalid", {
        headers: { "last-event-id": JSON.stringify(initial) },
      }),
      host,
      notifications,
      {},
      failures,
    ),
  );
  const replay = resumed.body!.getReader();
  await replay.read();
  await readBoundary(replay, "replay-start");
  expect(decode((await replay.read()).value)).toContain('"type":"run"');
  await readBoundary(replay, "replay-complete");
  expect(decode((await replay.read()).value)).toContain('"reason":"replay"');
  expect(decode((await replay.read()).value)).toContain('"sequence":1');
  const query = new URL("http://localhost/events?notifications=1");
  query.searchParams.set("notificationCursor", JSON.stringify(initial.notificationCursor));
  const fromQuery = await Effect.runPromise(
    createCombinedHostSseResponse(new Request(query), host, notifications, {}, failures),
  );
  const queryReplay = fromQuery.body!.getReader();
  await queryReplay.read();
  await readBoundary(queryReplay, "replay-start");
  await readBoundary(queryReplay, "replay-complete");
  expect(decode((await queryReplay.read()).value)).toContain('"reason":"replay"');
  expect(decode((await queryReplay.read()).value)).toContain('"sequence":1');
  await reader.cancel();
  await replay.cancel();
  await queryReplay.cancel();
  expect(hostStop).toHaveBeenCalledTimes(3);
  expect(failures).not.toHaveBeenCalled();
  host.emit({ channel: "openducktor://run-event", payload: { type: "after_cancel" } }, failures);
  notifications.publishHealth({ scope: "/repo", source: "session", message: null });
  expect(failures).not.toHaveBeenCalled();
  const restartedHost = new BufferedHostEventStream(256);
  const restarted = await Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events?notifications=1", {
        headers: { "last-event-id": JSON.stringify(initial) },
      }),
      restartedHost,
      notifications,
      {},
      failures,
    ),
  );
  const restartedReader = restarted.body!.getReader();
  try {
    await restartedReader.read();
    expect(await readBoundary(restartedReader, "replay-start")).toEqual({
      hostEpoch: restartedHost.hostEpoch,
      sequence: 0,
      hostChanged: true,
      losses: [],
    });
    await readBoundary(restartedReader, "replay-complete");
    expect(readCursor(decode((await restartedReader.read()).value)).hostEpoch).toBe(
      restartedHost.hostEpoch,
    );
  } finally {
    await restartedReader.cancel();
  }
});

test("a reconnect queues both full replay buffers with a scoped host loss", async () => {
  const host = new BufferedHostEventStream(256);
  const notifications = createNotificationStream();
  const failures = mock<(cause: unknown) => void>(() => {});
  const initial = await Effect.runPromise(
    Stream.runHead(notifications.subscribe({ cursor: null })).pipe(Effect.timeout("500 millis")),
  );
  if (initial._tag === "None") throw new Error("Expected an initial notification attachment");
  for (let index = 0; index < 257; index++)
    host.emit({ channel: "openducktor://run-event", payload: { index } }, failures);
  for (let index = 0; index < 256; index++)
    notifications.publishHealth({ scope: "/repo", source: "session", message: null });

  const replayed = Effect.runSync(Deferred.make<void>());
  const subscribe = notifications.subscribe.bind(notifications);
  const notificationSpy = spyOn(notifications, "subscribe").mockImplementation((input) =>
    subscribe(input).pipe(Stream.take(257), Stream.ensuring(Deferred.succeed(replayed, undefined))),
  );
  const response = await Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events", {
        headers: {
          "last-event-id": JSON.stringify({
            hostEpoch: host.hostEpoch,
            hostEventId: 0,
            notificationCursor: initial.value.cursor,
          }),
        },
      }),
      host,
      notifications,
      {},
      failures,
    ),
  );
  const reader = response.body!.getReader();
  try {
    // Fill the response with replay before the reader frees queue space.
    await Effect.runPromise(Deferred.await(replayed).pipe(Effect.timeout("500 millis")));
    expect(failures.mock.calls.map(([cause]) => String(cause))).toEqual([]);
    await Effect.runPromise(
      Effect.tryPromise(async () => {
        expect(decode((await reader.read()).value)).toContain(": openducktor-ready");
        expect(await readBoundary(reader, "replay-start")).toEqual({
          hostEpoch: host.hostEpoch,
          sequence: 257,
          hostChanged: false,
          losses: [{ channel: "openducktor://run-event", facet: "other" }],
        });
        const hostIds: number[] = [];
        for (let index = 0; index < 256; index++) {
          const frame = decode((await reader.read()).value);
          expect(frame).toContain("event: message");
          hostIds.push(readCursor(frame).hostEventId);
        }
        expect(hostIds).toEqual(Array.from({ length: 256 }, (_, index) => index + 2));
        await readBoundary(reader, "replay-complete");
        const attached = decode((await reader.read()).value);
        expect(attached).toContain('"reason":"replay"');
        const sequences: number[] = [];
        for (let index = 0; index < 256; index++) {
          const frame = decode((await reader.read()).value);
          expect(frame).toContain("event: notification-frame");
          sequences.push(readCursor(frame).notificationCursor!.sequence);
        }
        expect(sequences).toEqual(Array.from({ length: 256 }, (_, index) => index + 1));
      }).pipe(Effect.timeout("500 millis")),
    );
  } finally {
    await reader.cancel().catch(() => {});
    await Effect.runPromise(notifications.dispose());
    notificationSpy.mockRestore();
  }
});

test.each([
  "garbage",
  "42",
  '{"hostEpoch":"11111111-1111-4111-8111-111111111111","hostEventId":-1,"notificationCursor":null}',
  '{"hostEpoch":"11111111-1111-4111-8111-111111111111","hostEventId":0,"notificationCursor":{"epoch":"invalid","sequence":0}}',
  '{"hostEventId":0,"notificationCursor":null}',
])("invalid combined cursor %s rejects attachment visibly", async (raw) => {
  const host = new BufferedHostEventStream(256);
  const notifications = createNotificationStream();
  await expect(
    Effect.runPromise(
      createCombinedHostSseResponse(
        new Request("http://localhost/events", { headers: { "last-event-id": raw } }),
        host,
        notifications,
        {},
        () => {},
      ),
    ),
  ).rejects.toThrow("Invalid combined event subscription");
});

test("a stalled combined response fails once and releases both live subscriptions", async () => {
  const host = new BufferedHostEventStream(256);
  const notifications = createNotificationStream();
  const failures = mock(() => {});
  const hostStop = mock(() => {});
  const notificationStop = mock(() => {});
  const attached = Effect.runSync(Deferred.make<void>());
  const released = Effect.runSync(Deferred.make<void>());
  const subscribeHost = host.subscribe.bind(host);
  const hostSpy = spyOn(host, "subscribe").mockImplementation((listener) => {
    const stop = subscribeHost(listener);
    return () => {
      hostStop();
      stop();
    };
  });
  const subscribeNotifications = notifications.subscribe.bind(notifications);
  const notificationSpy = spyOn(notifications, "subscribe").mockImplementation((input) =>
    subscribeNotifications(input).pipe(
      Stream.tap((frame) =>
        frame.type === "attached" ? Deferred.succeed(attached, undefined) : Effect.void,
      ),
      Stream.ensuring(
        Effect.sync(notificationStop).pipe(Effect.zipRight(Deferred.succeed(released, undefined))),
      ),
    ),
  );
  const response = await Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events"),
      host,
      notifications,
      {},
      failures,
    ),
  );
  const reader = response.body!.getReader();
  try {
    await Effect.runPromise(Deferred.await(attached).pipe(Effect.timeout("500 millis")));
    for (let index = 0; index < 600; index++)
      host.emit({ channel: "openducktor://run-event", payload: { index } }, failures);
    expect(failures).toHaveBeenCalledTimes(1);
    await expect(reader.read()).rejects.toThrow("cannot keep up");
    await Effect.runPromise(Deferred.await(released).pipe(Effect.timeout("500 millis")));
    expect(hostStop).toHaveBeenCalledTimes(1);
    expect(notificationStop).toHaveBeenCalledTimes(1);
    notifications.publishHealth({ scope: "/repo", source: "session", message: null });
    expect(failures).toHaveBeenCalledTimes(1);
  } finally {
    await reader.cancel().catch(() => {});
    await Effect.runPromise(notifications.dispose());
    hostSpy.mockRestore();
    notificationSpy.mockRestore();
  }
});
