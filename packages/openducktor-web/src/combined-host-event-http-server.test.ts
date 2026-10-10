import { expect, mock, spyOn, test } from "bun:test";
import { Deferred, Effect, Stream } from "effect";
import { browserEventCursorSchema } from "@openducktor/contracts";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { BufferedHostEventStream } from "./typescript-host-backend-support";
import { createCombinedHostSseResponse } from "./combined-host-event-http-server";
import { liveSessionStreamEventName } from "./host-event-stream-name";

const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
const readCursor = (text: string) => {
  const id = text.split("\n").find((line) => line.startsWith("id: "));
  if (!id) throw new Error("Expected an SSE cursor");
  return browserEventCursorSchema.parse(JSON.parse(id.slice(4)));
};
const replayComplete = (hostChanged: boolean, gaps: string[]) =>
  `event: replay-complete\ndata: ${JSON.stringify({ hostChanged, gaps })}\n\n`;
const liveEvent = (repoPath: string, index: number) =>
  ({
    channel: "openducktor://agent-session-live-event",
    payload: { type: "fault", repoPath, message: `fault ${index}` },
  }) as const;
const resume = (
  host: BufferedHostEventStream,
  cursor: { hostEpoch: string; hostEventId: number },
) =>
  Effect.runPromise(
    createCombinedHostSseResponse(
      new Request("http://localhost/events", {
        headers: { "last-event-id": JSON.stringify({ notificationCursor: null, ...cursor }) },
      }),
      host,
      createNotificationStream(),
      {},
      () => {},
    ),
  );

test("one response carries host and notification frames with independent resume cursors", async () => {
  const host = new BufferedHostEventStream();
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
  expect(decode((await reader.read()).value)).toContain(replayComplete(false, []));
  const initial = readCursor(decode((await reader.read()).value));
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
  expect(decode((await replay.read()).value)).toContain('"type":"run"');
  expect(decode((await replay.read()).value)).toContain(replayComplete(false, []));
  expect(decode((await replay.read()).value)).toContain('"reason":"replay"');
  expect(decode((await replay.read()).value)).toContain('"sequence":1');
  const query = new URL("http://localhost/events?notifications=1");
  query.searchParams.set("notificationCursor", JSON.stringify(initial.notificationCursor));
  const fromQuery = await Effect.runPromise(
    createCombinedHostSseResponse(new Request(query), host, notifications, {}, failures),
  );
  const queryReplay = fromQuery.body!.getReader();
  await queryReplay.read();
  expect(decode((await queryReplay.read()).value)).toContain(replayComplete(false, []));
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
});

test("a reconnect queues both full replay buffers and reports the evicted channel", async () => {
  const host = new BufferedHostEventStream({
    events: 256,
    bytes: 1024 * 1024,
    totalBytes: 1024 * 1024,
  });
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
        const hostIds: number[] = [];
        for (let index = 0; index < 256; index++) {
          const frame = decode((await reader.read()).value);
          expect(frame).toContain("event: message");
          hostIds.push(readCursor(frame).hostEventId);
        }
        expect(hostIds).toEqual(Array.from({ length: 256 }, (_, index) => index + 2));
        const completed = decode((await reader.read()).value);
        expect(completed).toContain(replayComplete(false, ["message"]));
        expect(readCursor(completed).hostEventId).toBe(257);
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
  '{"hostEventId":0,"notificationCursor":null}',
  '{"hostEpoch":"host","hostEventId":-1,"notificationCursor":null}',
  '{"hostEpoch":"host","hostEventId":0,"notificationCursor":{"epoch":"invalid","sequence":0}}',
])("invalid combined cursor %s rejects attachment visibly", async (raw) => {
  const host = new BufferedHostEventStream();
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
  const host = new BufferedHostEventStream();
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
        Effect.sync(notificationStop).pipe(Effect.andThen(Deferred.succeed(released, undefined))),
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

test("a busy event name cannot evict the replay of another one", async () => {
  const host = new BufferedHostEventStream({
    events: 4,
    bytes: 1024 * 1024,
    totalBytes: 1024 * 1024,
  });
  host.emit(liveEvent("/quiet", 0), () => {});
  for (let index = 1; index <= 6; index++) host.emit(liveEvent("/busy", index), () => {});

  const reader = (
    await resume(host, { hostEpoch: host.hostEpoch, hostEventId: 0 })
  ).body!.getReader();
  try {
    await reader.read();
    const replayed: string[] = [];
    for (let index = 0; index < 5; index++) replayed.push(decode((await reader.read()).value));
    expect(replayed[0]).toContain(`event: ${liveSessionStreamEventName("/quiet")}`);
    expect(replayed.slice(1).map((frame) => readCursor(frame).hostEventId)).toEqual([4, 5, 6, 7]);
    expect(decode((await reader.read()).value)).toContain(
      replayComplete(false, [liveSessionStreamEventName("/busy")]),
    );
  } finally {
    await reader.cancel();
  }
});

test("a byte limit evicts large events and reports their gap", () => {
  const host = new BufferedHostEventStream({ events: 100, bytes: 300, totalBytes: 1024 * 1024 });
  for (let index = 0; index < 4; index++) host.emit(liveEvent("/repo", index), () => {});

  const replay = host.replayAfter(0);
  expect(replay.events.map((event) => event.id)).toEqual([3, 4]);
  expect(replay.gaps).toEqual([liveSessionStreamEventName("/repo")]);
  expect(host.replayAfter(2).gaps).toEqual([]);
});

test("a total byte limit evicts the oldest events of any event name", () => {
  const eventBytes = Buffer.byteLength(JSON.stringify(liveEvent("/a", 0)));
  const host = new BufferedHostEventStream({
    events: 100,
    bytes: 1024 * 1024,
    totalBytes: eventBytes * 3,
  });
  host.emit(liveEvent("/a", 0), () => {});
  host.emit(liveEvent("/b", 1), () => {});
  host.emit(liveEvent("/a", 2), () => {});
  host.emit(liveEvent("/c", 3), () => {});
  host.emit(liveEvent("/c", 4), () => {});

  const replay = host.replayAfter(0);
  expect(replay.events.map((event) => event.id)).toEqual([3, 4, 5]);
  expect(replay.gaps.toSorted()).toEqual(
    [liveSessionStreamEventName("/a"), liveSessionStreamEventName("/b")].toSorted(),
  );
  expect(host.replayAfter(2).gaps).toEqual([]);
});

test("a cursor from another host reports a host change without replay", async () => {
  const host = new BufferedHostEventStream();
  host.emit(liveEvent("/repo", 0), () => {});

  const reader = (
    await resume(host, { hostEpoch: "previous-host", hostEventId: 0 })
  ).body!.getReader();
  try {
    await reader.read();
    const completed = decode((await reader.read()).value);
    expect(completed).toContain(replayComplete(true, []));
    expect(readCursor(completed)).toMatchObject({ hostEpoch: host.hostEpoch, hostEventId: 1 });
  } finally {
    await reader.cancel();
  }
});
