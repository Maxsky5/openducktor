import { afterEach, expect, test } from "bun:test";
import {
  HOST_CHANNEL_HEARTBEAT_INTERVAL_MS,
  HOST_CHANNEL_RESULT_PART_BYTES,
  HOST_CHANNEL_SUBPROTOCOL,
  splitHostChannelFrame,
  hostEventEnvelopeSchema,
  taskEventLeaseSchema,
  type HostEventEnvelope,
  type RemoteAccessState,
  type TaskEventCursor,
} from "@openducktor/contracts";
import { Effect, Queue, Stream } from "effect";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createHostChannelSession } from "@openducktor/host-client/channel";
import { WebSocket } from "ws";
import { createHostChannelSocketData, type HostChannelOptions } from "./host-channel";
import { hostWebSocketHandler, type HostWebSocketData } from "./host-websocket-handler";
import { startNodeFetchServer } from "./node-fetch-server";
import { createFakeChannelSocket, type FakeChannelSocket } from "./host-channel.test-support";
import { BufferedHostEventStream } from "./host-event-bus";
import {
  BROWSER_EVENT_STREAM_NAME,
  STARTUP_EVENT_STREAM_NAME,
  liveSessionStreamEventName,
} from "@openducktor/host-client";
import { createTaskEventLeaseManager } from "./task-event-leases";
import { holdIntervals } from "./timers.test-support";

const runEvent = (index: number): HostEventEnvelope => ({
  channel: "openducktor://run-event",
  payload: { type: "autopilot_failure", failure: `failure ${index}` },
});
const liveEvent = (repoPath: string, index: number): HostEventEnvelope => ({
  channel: "openducktor://agent-session-live-event",
  payload: { type: "fault", repoPath, operation: "test", message: `fault ${index}` },
});
const browserEvent = (limit: number): HostEventEnvelope => ({
  channel: "openducktor://browser-event",
  payload: {
    type: "notice",
    tabId: "6f1d3f1e-8a52-4b8e-9d0c-2f4a5b6c7d8e",
    owner: { kind: "task", workspaceId: "workspace", taskId: "task" },
    notice: { kind: "popup_limit", limit },
  },
});
const startupEvent: HostEventEnvelope = {
  channel: "openducktor://session-startup-progress",
  payload: {
    context: { startupAttemptId: "attempt-1", operationId: "operation-1" },
    hostInstanceId: "host-1",
    revision: 1,
    workspaceId: "workspace-1",
    repoPath: "/repo",
    scope: { kind: "workspace" },
    phase: "running",
    steps: [],
    ownership: { state: "not_saved" },
  },
};
const taskEpoch = "fc49d1f9-708c-4198-b56b-f1437b2bbcea";
const taskCursor = (sequence: number): TaskEventCursor => ({ epoch: taskEpoch, sequence });

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Host services with real event, notification, and task streams. */
const createHost = (overrides: Partial<HostChannelOptions> = {}) => {
  const hostEvents = new BufferedHostEventStream({
    events: 4,
    bytes: 1024 * 1024,
    totalBytes: 1024 * 1024,
  });
  const notifications = createNotificationStream();
  const taskStream = createTaskEventStream({
    epochFactory: () => taskEpoch,
    reporter: { report: () => {} },
  });
  const leases = createTaskEventLeaseManager({
    taskEventStream: taskStream,
    reportDeliveryFailure: () => {},
  });
  const failures: unknown[] = [];
  const options: HostChannelOptions = {
    hostEvents,
    notifications,
    leases,
    ownedLeases: new Set(),
    invoke: async () => ({ result: null }),
    refusal: () => null,
    reportFailure: (cause) => failures.push(cause),
    ...overrides,
  };
  const sockets: FakeChannelSocket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.disconnect();
    leases.dispose();
    await Effect.runPromise(notifications.dispose());
  });
  return {
    options,
    hostEvents,
    notifications,
    leases,
    taskStream,
    failures,
    connect(extra: Partial<HostChannelOptions> = {}) {
      const socket = createFakeChannelSocket({ ...options, ...extra });
      sockets.push(socket);
      return socket;
    },
    emit(envelope: HostEventEnvelope) {
      hostEvents.emit(envelope, (cause) => failures.push(cause));
    },
    publishTask(sequence: number) {
      taskStream.publish({
        eventId: `event-${sequence}`,
        kind: "external_task_created",
        boardChanges: null,
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: `task-${sequence}`,
        taskSnapshot: {
          workflow: { id: "test-workflow", revision: 1 },
          id: `task-${sequence}`,
          title: "Task",
          status: "open",
        },
        emittedAt: "2026-07-23T12:00:00.000Z",
      });
    },
  };
};

const waitFor = async (check: () => boolean, what: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error(`Timed out waiting for ${what}.`);
};

/** The host events of a socket as name and event ID, in send order. */
const hostEvents = (socket: FakeChannelSocket) =>
  socket.ofType("host_event").map(({ header }) => [header.name, header.id]);

const indexOfReply = (socket: FakeChannelSocket, id: number) =>
  socket.sent.findIndex((message) => message === socket.reply(id));

test("replays retained host events before the open result, then sends live events", async () => {
  const host = createHost();
  host.emit(runEvent(1));
  host.emit(runEvent(2));
  const first = host.connect();
  const firstOpen = first.request({
    method: "events.open",
    cursor: null,
    notificationCursor: null,
  });
  const epoch = host.hostEvents.hostEpoch;
  expect(first.result(firstOpen)).toEqual({
    hostEpoch: epoch,
    hostEventId: 2,
    hostChanged: false,
    gaps: [],
  });
  expect(hostEvents(first)).toEqual([]);

  const socket = host.connect();
  const open = socket.request({
    method: "events.open",
    cursor: { hostEpoch: epoch, hostEventId: 1 },
    notificationCursor: null,
  });
  host.emit(runEvent(3));

  expect(hostEvents(socket)).toEqual([
    ["message", 2],
    ["message", 3],
  ]);
  const replayed = socket.ofType("host_event")[0];
  expect(hostEventEnvelopeSchema.parse(JSON.parse(replayed?.body ?? ""))).toEqual(runEvent(2));
  const resultIndex = indexOfReply(socket, open);
  expect(socket.sent.indexOf(replayed!)).toBeLessThan(resultIndex);
  expect(socket.sent.indexOf(socket.ofType("host_event")[1]!)).toBeGreaterThan(resultIndex);
  expect(socket.result(open)).toMatchObject({ hostEventId: 2, hostChanged: false });
  await waitFor(() => socket.ofType("notification").length > 0, "notification attachment");
  expect(socket.ofType("notification")[0]?.header.frame).toMatchObject({ type: "attached" });
});

test.each([
  {
    label: "a busy event name cannot evict the replay of another one",
    quiet: liveEvent("/quiet", 0),
    busy: (index: number) => liveEvent("/busy", index),
    quietName: liveSessionStreamEventName("/quiet"),
    busyName: liveSessionStreamEventName("/busy"),
  },
  {
    label: "browser tab events use their own event name",
    quiet: runEvent(0),
    busy: browserEvent,
    quietName: "message",
    busyName: BROWSER_EVENT_STREAM_NAME,
  },
  {
    label: "startup progress survives unrelated host event eviction",
    quiet: startupEvent,
    busy: runEvent,
    quietName: STARTUP_EVENT_STREAM_NAME,
    busyName: "message",
  },
])("$label", ({ quiet, busy, quietName, busyName }) => {
  const host = createHost();
  host.emit(quiet);
  for (let index = 1; index <= 6; index++) host.emit(busy(index));
  const socket = host.connect();
  const open = socket.request({
    method: "events.open",
    cursor: { hostEpoch: host.hostEvents.hostEpoch, hostEventId: 0 },
    notificationCursor: null,
  });

  expect(hostEvents(socket)).toEqual([
    [quietName, 1],
    [busyName, 4],
    [busyName, 5],
    [busyName, 6],
    [busyName, 7],
  ]);
  expect(socket.result(open)).toMatchObject({ hostEventId: 7, gaps: [busyName] });
});

test("a cursor from another host reports a host change without replay", () => {
  const host = createHost();
  host.emit(runEvent(1));
  const socket = host.connect();
  const open = socket.request({
    method: "events.open",
    cursor: { hostEpoch: "previous-host", hostEventId: 0 },
    notificationCursor: null,
  });

  expect(hostEvents(socket)).toEqual([]);
  expect(socket.result(open)).toEqual({
    hostEpoch: host.hostEvents.hostEpoch,
    hostEventId: 1,
    hostChanged: true,
    gaps: [],
  });
});

test("refuses a second events.open on one channel", () => {
  const socket = createHost().connect();
  socket.request({ method: "events.open", cursor: null, notificationCursor: null });
  const again = socket.request({ method: "events.open", cursor: null, notificationCursor: null });

  expect(socket.reply(again)?.header).toMatchObject({
    type: "error",
    error: { kind: "refused", failure: { code: "invalid_protocol" } },
  });
});

test("replays notifications after the client's notification cursor", async () => {
  const host = createHost();
  const first = host.connect();
  first.request({ method: "events.open", cursor: null, notificationCursor: null });
  await waitFor(() => first.ofType("notification").length > 0, "first attachment");
  const attached = first.ofType("notification")[0]!.header.frame;
  for (let index = 0; index < 3; index++)
    host.notifications.publishHealth({ scope: "/repo", source: "session", message: null });
  first.disconnect();

  const socket = host.connect();
  socket.request({ method: "events.open", cursor: null, notificationCursor: attached.cursor });
  await waitFor(() => socket.ofType("notification").length === 4, "notification replay");

  const frames = socket.ofType("notification").map(({ header }) => header.frame);
  expect(frames[0]).toMatchObject({ type: "attached", reason: "replay" });
  expect(frames.slice(1).map((frame) => frame.cursor.sequence)).toEqual([1, 2, 3]);
});

test.each([
  { label: "shutdown", shutdown: true },
  { label: "unexpected loss", shutdown: false },
])("closes the channel when notifications end by $label", async ({ shutdown }) => {
  let shuttingDown = false;
  const host = createHost({
    refusal: () =>
      shuttingDown
        ? { code: "unavailable", message: "Shutting down.", nextAction: "Reopen OpenDucktor." }
        : null,
  });
  const socket = host.connect();
  socket.request({ method: "events.open", cursor: null, notificationCursor: null });
  await waitFor(() => socket.ofType("notification").length > 0, "attachment");
  shuttingDown = shutdown;
  await Effect.runPromise(host.notifications.dispose());
  await waitFor(() => !socket.open, "channel close");

  expect(socket.closes).toEqual([{ code: 1011, reason: "Notification delivery stopped." }]);
  expect(host.failures).toHaveLength(shutdown ? 0 : 1);
  // A closed channel no longer receives host events.
  host.emit(runEvent(1));
  expect(hostEvents(socket)).toEqual([]);
});

test("closes a channel whose client lets events queue past the buffer limit", () => {
  const host = createHost();
  const socket = host.connect();
  socket.request({ method: "events.open", cursor: null, notificationCursor: null });
  socket.setBufferedAmount(64 * 1024 * 1024 + 1);
  host.emit(runEvent(1));

  expect(socket.closes).toEqual([{ code: 1013, reason: "Host channel consumer cannot keep up." }]);
  expect(hostEvents(socket)).toEqual([]);
});

test("sends a command result as the reply body", async () => {
  const calls: unknown[] = [];
  const socket = createHost({
    invoke: async (command, args) => {
      calls.push([command, args]);
      return { result: "linux" };
    },
  }).connect();
  const id = socket.request({ method: "invoke", command: "system_get_platform", args: { a: 1 } });
  await waitFor(() => socket.reply(id) !== undefined, "command reply");

  expect(calls).toEqual([["system_get_platform", { a: 1 }]]);
  expect(socket.result(id)).toBe("linux");
});

/** A host whose commands run until their signal aborts, and record that abort. */
const createBlockingHost = () => {
  const aborted: string[] = [];
  const settled: string[] = [];
  const host = createHost({
    invoke: (command, _args, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted.push(command);
            resolve({ result: null });
          },
          { once: true },
        );
        setTimeout(() => {
          settled.push(command);
          resolve({ result: "done" });
        }, 20);
      }),
  });
  return { host, aborted, settled };
};

test("interrupts a cancelled host read and sends no answer", async () => {
  const { host, aborted } = createBlockingHost();
  const socket = host.connect();
  const id = socket.request({
    method: "invoke",
    command: "workspace_get_git_provider_context",
    args: {},
  });
  socket.raw(JSON.stringify({ type: "cancel", id }));
  await waitFor(() => aborted.length === 1, "the interrupted read");
  await Bun.sleep(30);

  expect(aborted).toEqual(["workspace_get_git_provider_context"]);
  expect(socket.reply(id)).toBeUndefined();
});

test("keeps running a cancelled command that can change host state", async () => {
  const { host, aborted, settled } = createBlockingHost();
  const socket = host.connect();
  const id = socket.request({
    method: "invoke",
    command: "workspace_update_sidebar_session_grouping",
    args: { grouping: "none" },
  });
  socket.raw(JSON.stringify({ type: "cancel", id }));
  await waitFor(() => socket.reply(id) !== undefined, "the command result");

  expect(aborted).toEqual([]);
  expect(settled).toEqual(["workspace_update_sidebar_session_grouping"]);
});

test("interrupts running host reads when the socket closes", async () => {
  const { host, aborted } = createBlockingHost();
  const socket = host.connect();
  socket.request({ method: "invoke", command: "workspace_get_git_provider_context", args: {} });
  socket.request({
    method: "invoke",
    command: "workspace_update_sidebar_session_grouping",
    args: { grouping: "none" },
  });
  socket.disconnect();
  await waitFor(() => aborted.length === 1, "the interrupted read");

  expect(aborted).toEqual(["workspace_get_git_provider_context"]);
});

test("refuses a command while the host refuses work, without running it", async () => {
  let calls = 0;
  const refused = {
    code: "unavailable" as const,
    message: "The host is shutting down.",
    nextAction: "Reopen OpenDucktor.",
  };
  const socket = createHost({
    invoke: async () => {
      calls += 1;
      return { result: null };
    },
    refusal: () => refused,
  }).connect();
  const id = socket.request({ method: "invoke", command: "system_get_platform", args: {} });
  await waitFor(() => socket.reply(id) !== undefined, "command refusal");

  expect(socket.reply(id)?.header).toEqual({
    type: "error",
    id,
    error: { kind: "refused", failure: refused },
  });
  expect(calls).toBe(0);
});

/** A host whose `read` command returns a string that needs three result parts. */
const createLargeResultHost = () => {
  const large = "x".repeat(2 * HOST_CHANNEL_RESULT_PART_BYTES);
  const socket = createHost({
    invoke: async (command) => ({ result: command === "read" ? large : "small" }),
  }).connect();
  /** The messages of request `id` as their types, in send order. */
  const typesOf = (id: number) =>
    socket.sent.flatMap(({ header }) =>
      "id" in header && header.id === id && header.type !== "host_event" ? [header.type] : [],
    );
  return { socket, large, typesOf };
};

test("sends a large result in parts, and other replies pass between parts on a slow socket", async () => {
  const { socket, large, typesOf } = createLargeResultHost();
  socket.stall();
  const read = socket.request({ method: "invoke", command: "read", args: {} });
  await waitFor(() => typesOf(read).length === 1, "the first result part");
  const small = socket.request({ method: "invoke", command: "small", args: {} });
  await waitFor(() => socket.reply(small) !== undefined, "the small reply");

  expect(typesOf(read)).toEqual(["result_part"]);
  socket.flush();
  expect(typesOf(read)).toEqual(["result_part", "result_part", "result"]);
  expect(indexOfReply(socket, small)).toBeLessThan(indexOfReply(socket, read));
  expect(socket.result(read)).toBe(large);
  expect(socket.result(small)).toBe("small");
});

test("a client session joins a large result in parts over a real socket", async () => {
  const large = { text: "é".repeat(HOST_CHANNEL_RESULT_PART_BYTES) };
  const host = createHost({ invoke: async () => ({ result: large }) });
  const server = await startNodeFetchServer<HostWebSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    websocket: hostWebSocketHandler,
    fetch: (_request, requestServer) =>
      Promise.resolve(
        requestServer.upgrade({ data: createHostChannelSocketData(host.options) })
          ? undefined
          : new Response("WebSocket upgrade failed.", { status: 500 }),
      ),
    onError: (cause) => host.failures.push(cause),
  });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/channel`, [HOST_CHANNEL_SUBPROTOCOL]);
  cleanups.push(() => server.stop(true));
  const types: string[] = [];
  const session = createHostChannelSession({
    send: (frame) => socket.send(frame),
    handlers: { hostEvent: () => {}, notification: () => {} },
    onHandlerError: (cause) => host.failures.push(cause),
  });
  socket.on("message", (data: Buffer) => {
    const frame = new Uint8Array(data);
    types.push(JSON.parse(splitHostChannelFrame(frame).header).type);
    session.receive(frame);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  const result = await session.request({ method: "invoke", command: "read", args: {} });

  expect(result).toEqual(large);
  expect(types.filter((type) => type === "result_part").length).toBeGreaterThan(1);
  expect(types.at(-1)).toBe("result");
  expect(host.failures).toEqual([]);
  socket.close();
});

test("a cancel drops the unsent parts of a large result", async () => {
  const { socket, typesOf } = createLargeResultHost();
  socket.stall();
  const read = socket.request({ method: "invoke", command: "read", args: {} });
  await waitFor(() => typesOf(read).length === 1, "the first result part");
  socket.raw(JSON.stringify({ type: "cancel", id: read }));
  socket.flush();

  expect(typesOf(read)).toEqual(["result_part"]);
});

test("sends a host error and refuses a reply over the size limit", async () => {
  const socket = createHost({
    maxReplyBytes: 16,
    invoke: async (command) =>
      command === "fail"
        ? { error: { kind: "host", response: { error: "failed", message: "Command failed." } } }
        : { result: "x".repeat(32) },
  }).connect();
  const failed = socket.request({ method: "invoke", command: "fail", args: {} });
  const large = socket.request({ method: "invoke", command: "read", args: {} });
  await waitFor(() => socket.reply(large) !== undefined, "replies");

  expect(socket.reply(failed)?.header).toEqual({
    type: "error",
    id: failed,
    error: { kind: "host", response: { error: "failed", message: "Command failed." } },
  });
  expect(socket.reply(large)?.header).toEqual({
    type: "error",
    id: large,
    error: { kind: "reply_too_large", limitBytes: 16 },
  });
});

test("closes the channel and reports a command delivery that throws", async () => {
  const host = createHost({
    invoke: async () => {
      throw new Error("policy bug");
    },
  });
  const socket = host.connect();
  socket.request({ method: "invoke", command: "read", args: {} });
  await waitFor(() => !socket.open, "channel close");

  expect(socket.closes).toEqual([{ code: 1011, reason: "Host command delivery failed." }]);
  expect(host.failures).toHaveLength(1);
});

test("sends the task lease before its frames and delivers live frames", async () => {
  const host = createHost();
  const socket = host.connect();
  const id = socket.request({
    method: "task_events.subscribe",
    input: { cursor: null },
  });
  await waitFor(() => socket.ofType("task_frame").length === 1, "snapshot frame");
  const lease = taskEventLeaseSchema.parse(socket.result(id));
  // The stream holds changes until the client applied the snapshot.
  socket.request({
    method: "task_events.ack",
    subscriptionId: lease.subscriptionId,
    cursor: taskCursor(0),
  });
  host.publishTask(1);
  await waitFor(() => socket.ofType("task_frame").length === 2, "live frame");

  expect(lease.replayBoundary).toEqual(taskCursor(0));
  expect(indexOfReply(socket, id)).toBe(0);
  expect(
    socket
      .ofType("task_frame")
      .map(({ header }) => [
        header.subscriptionId,
        header.frame.type,
        header.frame.cursor.sequence,
      ]),
  ).toEqual([
    [lease.subscriptionId, "snapshot_required", 0],
    [lease.subscriptionId, "change", 1],
  ]);
  expect(host.options.ownedLeases.has(lease.subscriptionId)).toBe(true);
});

test("refuses task subscriptions over the lease limit and while the host refuses work", () => {
  let refused = false;
  const host = createHost({
    maxLeases: 1,
    refusal: () =>
      refused ? { code: "remote_disabled", message: "Ended.", nextAction: "Reconnect." } : null,
  });
  const socket = host.connect();
  socket.request({ method: "task_events.subscribe", input: { cursor: null } });
  const overLimit = socket.request({ method: "task_events.subscribe", input: { cursor: null } });
  refused = true;
  const disabled = socket.request({ method: "task_events.subscribe", input: { cursor: null } });

  expect(socket.reply(overLimit)?.header).toMatchObject({
    error: { kind: "refused", failure: { code: "consumer_overflow" } },
  });
  expect(socket.reply(disabled)?.header).toMatchObject({
    error: { kind: "refused", failure: { code: "remote_disabled" } },
  });
});

test("refuses attach, ack, and release of a lease that another principal owns", () => {
  const host = createHost();
  const owner = host.connect();
  const id = owner.request({ method: "task_events.subscribe", input: { cursor: null } });
  const { subscriptionId } = taskEventLeaseSchema.parse(owner.result(id));
  const other = host.connect({ ownedLeases: new Set() });
  const attach = other.request({ method: "task_events.attach", subscriptionId });
  const ack = other.request({ method: "task_events.ack", subscriptionId, cursor: taskCursor(0) });
  const release = other.request({ method: "task_events.release", subscriptionId });

  for (const request of [attach, ack])
    expect(other.reply(request)?.header).toMatchObject({
      error: { kind: "refused", failure: { code: "connection_expired" } },
    });
  // A release of a foreign lease changes nothing.
  expect(other.result(release)).toBeNull();
  expect(host.leases.get(subscriptionId)).toBeDefined();
});

test("keeps a lease after the socket closes and replays unacknowledged frames on attach", async () => {
  const host = createHost();
  const first = host.connect();
  const id = first.request({ method: "task_events.subscribe", input: { cursor: taskCursor(0) } });
  const { subscriptionId } = taskEventLeaseSchema.parse(first.result(id));
  host.publishTask(1);
  host.publishTask(2);
  await waitFor(() => first.ofType("task_frame").length === 2, "first frames");
  const ack = first.request({ method: "task_events.ack", subscriptionId, cursor: taskCursor(1) });
  expect(first.result(ack)).toBeNull();
  first.disconnect();

  const lease = host.leases.get(subscriptionId);
  expect(lease?.connection).toBeNull();
  expect(lease?.expiryTimer).not.toBeNull();
  const second = host.connect();
  const attach = second.request({ method: "task_events.attach", subscriptionId });
  await waitFor(() => second.ofType("task_frame").length === 1, "replayed frame");

  expect(second.result(attach)).toBeNull();
  expect(lease?.expiryTimer).toBeNull();
  expect(second.ofType("task_frame")[0]?.header.frame.cursor).toEqual(taskCursor(2));
});

test("refuses an acknowledgement that the task stream rejects", async () => {
  const host = createHost();
  const socket = host.connect();
  const id = socket.request({ method: "task_events.subscribe", input: { cursor: taskCursor(0) } });
  const { subscriptionId } = taskEventLeaseSchema.parse(socket.result(id));
  const ack = socket.request({ method: "task_events.ack", subscriptionId, cursor: taskCursor(9) });

  expect(socket.reply(ack)?.header).toMatchObject({
    error: { kind: "refused", failure: { code: "invalid_protocol" } },
  });
});

test("releases an owned lease", () => {
  const host = createHost();
  const socket = host.connect();
  const id = socket.request({ method: "task_events.subscribe", input: { cursor: null } });
  const { subscriptionId } = taskEventLeaseSchema.parse(socket.result(id));
  const release = socket.request({ method: "task_events.release", subscriptionId });

  expect(socket.result(release)).toBeNull();
  expect(host.leases.get(subscriptionId)).toBeUndefined();
  expect(host.options.ownedLeases.has(subscriptionId)).toBe(false);
});

test("pauses task frames while the socket buffers and resumes them on drain", async () => {
  const host = createHost();
  const socket = host.connect();
  socket.request({ method: "task_events.subscribe", input: { cursor: taskCursor(0) } });
  socket.setBufferedAmount(1024 * 1024);
  host.publishTask(1);
  await Bun.sleep(1);
  expect(socket.ofType("task_frame")).toEqual([]);

  socket.flush();
  await waitFor(() => socket.ofType("task_frame").length === 1, "resumed frame");
  expect(socket.ofType("task_frame")[0]?.header.frame.cursor).toEqual(taskCursor(1));
});

test("sends remote access states while observed", async () => {
  const states = Effect.runSync(Queue.unbounded<RemoteAccessState>());
  const state = (connectedClients: number): RemoteAccessState => ({
    status: "available",
    configuration: null,
    pairing: null,
    clients: [],
    connectedClients,
  });
  const socket = createHost({ remoteAccessStates: Stream.fromQueue(states) }).connect();
  const observe = socket.request({ method: "remote_access.observe" });
  Queue.offerUnsafe(states, state(1));
  await waitFor(() => socket.ofType("remote_access_state").length === 1, "state");
  const unobserve = socket.request({ method: "remote_access.unobserve" });
  Queue.offerUnsafe(states, state(2));
  await Bun.sleep(1);

  expect(socket.result(observe)).toBeNull();
  expect(socket.result(unobserve)).toBeNull();
  expect(socket.ofType("remote_access_state").map(({ header }) => header.state)).toEqual([
    state(1),
  ]);
});

test("refuses remote access observation without a state stream", () => {
  const socket = createHost().connect();
  const observe = socket.request({ method: "remote_access.observe" });

  expect(socket.reply(observe)?.header).toMatchObject({
    error: { kind: "refused", failure: { code: "function_unavailable" } },
  });
});

test.each(["not json", '{"type":"request","id":0,"method":"unknown"}', '{"type":"request"}'])(
  "closes the channel after an invalid message %s",
  (text) => {
    const socket = createHost().connect();
    socket.raw(text);

    expect(socket.closes).toEqual([{ code: 1002, reason: "Invalid host channel message." }]);
  },
);

test("sends a heartbeat at its interval and stops it when the socket closes", () => {
  const heartbeats = holdIntervals(HOST_CHANNEL_HEARTBEAT_INTERVAL_MS);
  try {
    const socket = createHost().connect();
    expect(heartbeats.held.size).toBe(1);
    for (const beat of heartbeats.held.values()) beat();
    expect(socket.ofType("heartbeat")).toHaveLength(1);
    socket.disconnect();
    expect(heartbeats.held.size).toBe(0);
  } finally {
    heartbeats.restore();
  }
});

test("closes the channel when the admission signal aborts", () => {
  const admission = new AbortController();
  const socket = createHost({ signal: admission.signal }).connect();
  admission.abort();

  expect(socket.closes).toEqual([{ code: 1001, reason: "Remote connection ended." }]);
});
