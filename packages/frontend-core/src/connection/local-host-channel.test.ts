import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type {
  HostChannelRequestMessage,
  NotificationCursor,
  NotificationStreamFrame,
  HostEventEnvelope,
  RemoteAccessState,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  createFakeHostChannel,
  FakeClientSocket,
  type FakeHostChannel,
  type FakeHostChannelOptions,
} from "@openducktor/host-client/remote/test-support/host-channel";
import {
  createLocalHostChannel,
  type LocalHostChannel,
  type LocalHostChannelDependencies,
  type LocalHostChannelEvent,
} from "./local-host-channel";
import { openWebSocket } from "@openducktor/host-client/remote/socket";

const SILENCE_DELAY_MS = 45_000;
const SETUP_DELAY_MS = 10_000;
/** Timers that the test runs on their own: the silence and setup deadlines. */
const isDeadline = (entry: Scheduled) =>
  entry.delayMs === SILENCE_DELAY_MS || entry.delayMs === SETUP_DELAY_MS;

type Scheduled = { callback: () => void; delayMs: number; cancelled: boolean };

/** Holds every reconnect and silence timer until the test runs it. */
const createManualSchedule = () => {
  const scheduled: Scheduled[] = [];
  return {
    schedule: (callback: () => void, delayMs: number) => {
      const entry = { callback, delayMs, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    /** Runs the pending reconnect timers. Deadline timers stay pending. */
    runReconnects: () => {
      for (const entry of scheduled.splice(0)) {
        if (entry.cancelled) continue;
        if (isDeadline(entry)) scheduled.push(entry);
        else entry.callback();
      }
    },
    runSetupDeadline: () => {
      for (const entry of scheduled)
        if (!entry.cancelled && entry.delayMs === SETUP_DELAY_MS) {
          entry.cancelled = true;
          entry.callback();
        }
    },
    runSilence: () => {
      for (const entry of scheduled)
        if (!entry.cancelled && entry.delayMs === SILENCE_DELAY_MS) {
          entry.cancelled = true;
          entry.callback();
        }
    },
    pendingReconnects: () =>
      scheduled.filter((entry) => !entry.cancelled && !isDeadline(entry)).length,
  };
};

/** Opens a client socket of `create` the way a shell opens its platform socket. */
const socketOf =
  (create: (protocols: string[]) => FakeClientSocket): LocalHostChannelDependencies["openSocket"] =>
  (_url, protocols, signal, onFrame, onClose) =>
    openWebSocket(create, protocols, signal, onFrame, onClose);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  for (let index = 0; index < 50; index += 1) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const providerSetupEvent = (revision: number): HostEventEnvelope => ({
  channel: "openducktor://workspace-provider-setup-updated",
  payload: {
    setupId: crypto.randomUUID(),
    repoPath: "/repo",
    revision,
    configurationFingerprint: "fingerprint",
    attemptId: crypto.randomUUID(),
    state: { status: "disconnected" },
  },
});

const disabledState: RemoteAccessState = {
  status: "disabled",
  configuration: null,
  connectedClients: null,
  clients: null,
  pairing: null,
};

const snapshotFrame = (sequence: number): TaskEventStreamFrame => ({
  type: "snapshot_required",
  cursor: { epoch: "00000000-0000-4000-8000-000000000002", sequence },
  reason: "buffer_gap",
});

const methods = (requests: HostChannelRequestMessage[]) =>
  requests.map((request) => request.method);

type Setup = {
  channel: LocalHostChannel;
  timers: ReturnType<typeof createManualSchedule>;
  /** The fake host that answers the next socket. */
  host: () => FakeHostChannel;
  replaceHost(options: FakeHostChannelOptions): FakeHostChannel;
  disposed: () => number;
  failPrepare(failure: Error | null): void;
};

const channels: LocalHostChannel[] = [];
const releases: Array<() => void> = [];

afterEach(() => {
  for (const release of releases.splice(0)) release();
  channels.length = 0;
});

const setup = (
  options: FakeHostChannelOptions = {},
  notificationCursor: NotificationCursor | null = null,
): Setup => {
  const timers = createManualSchedule();
  let host = createFakeHostChannel(options);
  let disposals = 0;
  let prepareFailure: Error | null = null;
  const channel = createLocalHostChannel({
    prepare: async () => {
      if (prepareFailure) throw prepareFailure;
      return { url: "ws://127.0.0.1:1/channel", token: null };
    },
    openSocket: socketOf((protocols) => host.createSocket(protocols)),
    notificationCursor,
    onDispose: () => {
      disposals += 1;
    },
    schedule: timers.schedule,
  });
  channels.push(channel);
  return {
    channel,
    timers,
    host: () => host,
    replaceHost: (next) => {
      host = createFakeHostChannel(next);
      return host;
    },
    disposed: () => disposals,
    failPrepare: (failure) => {
      prepareFailure = failure;
    },
  };
};

const listen = (
  channel: LocalHostChannel,
  eventName = "message",
  eventChannel: HostEventEnvelope["channel"] = "openducktor://workspace-provider-setup-updated",
) => {
  const events: LocalHostChannelEvent[] = [];
  const remove = channel.addListener({
    channel: eventChannel,
    eventName,
    listener: (event) => {
      events.push(event);
    },
    receivesControlEvents: true,
  });
  releases.push(remove);
  return { events, remove };
};

const controlKinds = (events: LocalHostChannelEvent[]) =>
  events.flatMap((event) => ("__openducktorConnectionControl" in event ? [event.kind] : []));

/** Closes the socket from the host and runs the reconnect after the client saw the loss. */
const reconnect = async (test: Setup) => {
  const before = test.host().sockets.length;
  test.host().closeAll();
  await waitFor(() => test.timers.pendingReconnects() > 0, "the reconnect timer");
  test.timers.runReconnects();
  await waitFor(() => test.host().sockets.length > before, "the new socket");
};

describe("createLocalHostChannel", () => {
  test("resolves ready after the first replay and delivers live events", async () => {
    const test = setup();
    const { events } = listen(test.channel);
    await test.channel.ready;
    expect(methods(test.host().requests)).toEqual(["events.open"]);
    const sent = providerSetupEvent(1);
    test.host().emit(sent);
    await waitFor(() => events.length === 1, "the live event");
    expect(events).toEqual([sent]);
    expect(test.channel.readConnectionWarning()).toBeNull();
  });

  test("does not parse events of an unobserved event name", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const test = setup();
      const { events } = listen(test.channel);
      await test.channel.ready;
      // SAFETY: the invalid body would fail the envelope parser if the channel read it.
      test.host().emit({ channel: "openducktor://browser-event" } as never, "browser");
      test.host().emit(providerSetupEvent(2));
      await waitFor(() => events.length === 1, "the observed event");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("replays missed events from its cursor after a reconnect", async () => {
    const test = setup();
    const { events } = listen(test.channel);
    await test.channel.ready;
    test.host().emit(providerSetupEvent(1));
    await waitFor(() => events.length === 1, "the first event");
    test.host().closeAll();
    await waitFor(() => controlKinds(events).includes("stream-warning"), "the warning");
    const missed = providerSetupEvent(2);
    test.host().emit(missed);
    await waitFor(() => test.timers.pendingReconnects() > 0, "the reconnect timer");
    test.timers.runReconnects();
    await waitFor(() => controlKinds(events).includes("reconnected"), "the reconnect");
    const reopen = test.host().sockets[1]?.requests[0];
    expect(reopen).toMatchObject({
      method: "events.open",
      cursor: { hostEpoch: "fake-host-epoch", hostEventId: 1 },
    });
    expect(events.at(-2)).toEqual(missed);
    expect(events.at(-1)).toMatchObject({
      kind: "reconnected",
      missedEvents: false,
      hostChanged: false,
    });
    expect(test.channel.readConnectionWarning()).toBeNull();
  });

  test("reports missed events after a host change", async () => {
    const test = setup();
    const { events } = listen(test.channel);
    await test.channel.ready;
    test.host().closeAll();
    await waitFor(() => test.timers.pendingReconnects() > 0, "the reconnect timer");
    const restarted = test.replaceHost({ hostEpoch: "restarted-epoch" });
    test.timers.runReconnects();
    await waitFor(() => controlKinds(events).includes("reconnected"), "the reconnect");
    expect(restarted.requests[0]).toMatchObject({
      method: "events.open",
      cursor: { hostEpoch: "fake-host-epoch" },
    });
    expect(events.at(-1)).toMatchObject({ missedEvents: true, hostChanged: true });
  });

  test("reports missed events only to the listeners of an event name with a gap", async () => {
    let opens = 0;
    const test = setup({
      answer: (request) => {
        if (request.method !== "events.open" || ++opens === 1) return undefined;
        return {
          result: {
            hostEpoch: "fake-host-epoch",
            hostEventId: 9,
            hostChanged: false,
            gaps: ["message"],
          },
        };
      },
    });
    const message = listen(test.channel);
    const browser = listen(test.channel, "browser", "openducktor://browser-event");
    await test.channel.ready;
    await reconnect(test);
    await waitFor(
      () => controlKinds(browser.events).includes("reconnected"),
      "the browser reconnect",
    );
    expect(message.events.at(-1)).toMatchObject({
      missedEvents: true,
      missedEventNames: ["message"],
    });
    expect(browser.events.at(-1)).toMatchObject({ missedEvents: false });
  });

  test("reports one warning per failure episode and fails notification subscribers", async () => {
    const test = setup();
    const { events } = listen(test.channel);
    const failures: unknown[] = [];
    const stop = test.channel.subscribeNotifications(
      { cursor: null },
      () => {},
      (cause) => {
        failures.push(cause);
      },
    );
    releases.push(stop);
    await test.channel.ready;
    test.host().closeAll();
    await waitFor(() => test.timers.pendingReconnects() > 0, "the reconnect timer");
    test.failPrepare(new Error("host is down"));
    test.timers.runReconnects();
    await waitFor(() => test.timers.pendingReconnects() > 0, "the second reconnect timer");
    expect(controlKinds(events)).toEqual(["stream-warning"]);
    expect(failures).toHaveLength(1);
    expect(test.channel.readConnectionWarning()).toContain("after opening");
    test.failPrepare(null);
    test.timers.runReconnects();
    await waitFor(() => controlKinds(events).includes("reconnected"), "the reconnect");
    expect(controlKinds(events)).toEqual(["stream-warning", "reconnected"]);
  });

  test("opens for a notification subscriber and sends its cursor", async () => {
    const cursor = { epoch: "11111111-1111-4111-8111-111111111111", sequence: 42 };
    const test = setup({}, cursor);
    const frames: NotificationStreamFrame[] = [];
    const stop = test.channel.subscribeNotifications(
      { cursor },
      (frame) => frames.push(frame),
      () => {},
    );
    await waitFor(() => frames.length === 1, "the attached frame");
    expect(test.host().requests[0]).toMatchObject({
      method: "events.open",
      notificationCursor: cursor,
    });
    expect(frames[0]).toMatchObject({ type: "attached" });
    stop();
    expect(test.disposed()).toBe(1);
  });

  test("treats a silent channel as lost", async () => {
    const test = setup();
    const { events } = listen(test.channel);
    await test.channel.ready;
    test.timers.runSilence();
    await waitFor(() => controlKinds(events).includes("stream-warning"), "the warning");
    expect(test.channel.readConnectionWarning()).toContain("went silent");
    expect(test.timers.pendingReconnects()).toBe(1);
  });

  test("attaches task leases again after a reconnect", async () => {
    const test = setup();
    const frames: TaskEventStreamFrame[] = [];
    const failures: unknown[] = [];
    const subscription = await test.channel.subscribeTaskEvents(
      { cursor: null },
      (frame) => frames.push(frame),
      (cause) => failures.push(cause),
    );
    releases.push(() => void subscription.unsubscribe());
    await reconnect(test);
    await waitFor(
      () => methods(test.host().requests).includes("task_events.attach"),
      "the lease attach",
    );
    expect(test.host().requests.at(-1)).toMatchObject({
      method: "task_events.attach",
      subscriptionId: subscription.subscriptionId,
    });
    await tick();
    test.host().taskFrame(subscription.subscriptionId, snapshotFrame(3));
    await waitFor(() => frames.length === 1, "the replayed frame");
    expect(frames).toEqual([snapshotFrame(3)]);
    expect(failures).toEqual([]);
  });

  test("reports a terminal failure when the host lost a task lease", async () => {
    const test = setup();
    const failures: unknown[] = [];
    await test.channel.subscribeTaskEvents(
      { cursor: null },
      () => {},
      (cause) => {
        failures.push(cause);
      },
    );
    // The channel stays in use through this listener after the lease ends.
    listen(test.channel);
    test.host().dropLeases();
    await reconnect(test);
    await waitFor(() => failures.length === 1, "the terminal failure");
    expect(String(failures[0])).toContain("Task subscription is expired.");
  });

  test("releases a lease that the owner left while the lease attached again", async () => {
    const test = setup();
    listen(test.channel);
    const subscription = await test.channel.subscribeTaskEvents(
      { cursor: null },
      () => {},
      undefined,
    );
    test.host().closeAll();
    await waitFor(() => test.timers.pendingReconnects() > 0, "the reconnect timer");
    test.timers.runReconnects();
    // The owner leaves after the attach request and before its result.
    await waitFor(
      () => methods(test.host().requests).includes("task_events.attach"),
      "the lease attach",
    );
    await subscription.unsubscribe();
    await waitFor(
      () => methods(test.host().requests).includes("task_events.release"),
      "the late release",
    );
    expect(methods(test.host().requests).slice(-2)).toEqual([
      "task_events.attach",
      "task_events.release",
    ]);
  });

  test("closes the socket of an attempt that finishes after disposal", async () => {
    const test = setup();
    const { remove } = listen(test.channel);
    remove();
    expect(test.disposed()).toBe(1);
    await tick();
    await tick();
    expect(test.host().sockets.every((socket) => socket.closed)).toBe(true);
  });

  test("acknowledges a task cursor and releases the lease on unsubscribe", async () => {
    const test = setup();
    const subscription = await test.channel.subscribeTaskEvents(
      { cursor: null },
      () => {},
      undefined,
    );
    const cursor = snapshotFrame(4).cursor;
    await subscription.acknowledge(cursor);
    await subscription.unsubscribe();
    expect(test.host().requests.slice(-2)).toEqual([
      expect.objectContaining({ method: "task_events.ack", cursor }),
      expect.objectContaining({
        method: "task_events.release",
        subscriptionId: subscription.subscriptionId,
      }),
    ]);
    expect(test.disposed()).toBe(1);
  });

  test("observes remote access state again after a reconnect", async () => {
    const test = setup();
    // The listener keeps the channel open after the observer leaves.
    const { events } = listen(test.channel);
    const states: RemoteAccessState[] = [];
    const stop = test.channel.observeRemoteAccess((state) => states.push(state));
    await waitFor(
      () => methods(test.host().requests).includes("remote_access.observe"),
      "the observe request",
    );
    test.host().remoteAccessState(disabledState);
    await waitFor(() => states.length === 1, "the first state");
    await reconnect(test);
    await waitFor(
      () => methods(test.host().sockets[1]?.requests ?? []).includes("remote_access.observe"),
      "the second observe request",
    );
    expect(states[1]).toMatchObject({ status: "failed", failure: { code: "transport_failure" } });
    await waitFor(() => controlKinds(events).includes("reconnected"), "the reconnect");
    stop();
    await waitFor(
      () => methods(test.host().requests).includes("remote_access.unobserve"),
      "the unobserve request",
    );
  });

  test("connects a closed channel for a request and closes it when nothing uses it", async () => {
    const test = setup({ invoke: () => ({ result: { ok: true } }) });
    await expect(
      test.channel.request({ method: "invoke", command: "git_check", args: {} }),
    ).resolves.toEqual({ ok: true });
    expect(methods(test.host().requests)).toEqual(["events.open", "invoke"]);
    expect(test.disposed()).toBe(1);
    expect(test.host().sockets[0]?.closed).toBe(true);
  });

  test("rejects a request when its connection attempt fails", async () => {
    const test = setup();
    test.failPrepare(new Error("session refused"));
    await expect(
      test.channel.request({ method: "invoke", command: "git_check", args: {} }),
    ).rejects.toThrow("session refused");
    expect(test.host().sockets).toHaveLength(0);
  });

  test("rejects an aborted request at once", async () => {
    const test = setup({ invoke: () => "none" });
    listen(test.channel);
    await test.channel.ready;
    const abort = new AbortController();
    const pending = test.channel.request(
      { method: "invoke", command: "path_check", args: {} },
      abort.signal,
    );
    await waitFor(() => methods(test.host().requests).includes("invoke"), "the invoke request");
    const reason = new Error("diagnostics timeout");
    abort.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  test("stops waiting for a channel that never opens when the caller aborts", async () => {
    const timers = createManualSchedule();
    const sockets: FakeClientSocket[] = [];
    let disposals = 0;
    const channel = createLocalHostChannel({
      prepare: async () => ({ url: "ws://127.0.0.1:1/channel", token: null }),
      // The upgrade never completes.
      openSocket: socketOf(() => {
        const socket = new FakeClientSocket(
          () => {},
          () => {
            socket.readyState = 3;
          },
        );
        sockets.push(socket);
        return socket;
      }),
      notificationCursor: null,
      onDispose: () => {
        disposals += 1;
      },
      schedule: timers.schedule,
    });
    const abort = new AbortController();
    const pending = channel.request(
      { method: "invoke", command: "path_check", args: {} },
      abort.signal,
    );
    await waitFor(() => sockets.length === 1, "the socket");
    const reason = new Error("diagnostics timeout");
    abort.abort(reason);
    await expect(pending).rejects.toBe(reason);
    // Nothing else uses the channel, so the request no longer holds the attempt open.
    expect(disposals).toBe(1);
    expect(sockets[0]?.readyState).toBe(3);
  });

  test("fails a stalled handshake at the setup deadline and reconnects", async () => {
    const timers = createManualSchedule();
    const sockets: FakeClientSocket[] = [];
    const host = createFakeHostChannel();
    let stall = true;
    const channel = createLocalHostChannel({
      prepare: async () => ({ url: "ws://127.0.0.1:1/channel", token: null }),
      openSocket: socketOf((protocols) => {
        if (!stall) return host.createSocket(protocols);
        const socket = new FakeClientSocket(
          () => {},
          () => {
            socket.readyState = 3;
          },
        );
        sockets.push(socket);
        return socket;
      }),
      notificationCursor: null,
      onDispose: () => {},
      schedule: timers.schedule,
    });
    const events: LocalHostChannelEvent[] = [];
    releases.push(
      channel.addListener({
        channel: "openducktor://workspace-provider-setup-updated",
        eventName: "message",
        listener: (event) => {
          events.push(event);
        },
        receivesControlEvents: true,
      }),
    );
    await waitFor(() => sockets.length === 1, "the stalled socket");
    timers.runSetupDeadline();
    await waitFor(() => timers.pendingReconnects() > 0, "the reconnect timer");
    expect(sockets[0]?.readyState).toBe(3);
    expect(channel.readConnectionWarning()).toContain("did not finish setup");
    expect(controlKinds(events)).toEqual(["stream-warning"]);
    stall = false;
    timers.runReconnects();
    await channel.ready;
    expect(channel.readConnectionWarning()).toBeNull();
  });

  test("closes the channel when its last listener leaves", async () => {
    const test = setup();
    const { remove } = listen(test.channel);
    await test.channel.ready;
    remove();
    expect(test.disposed()).toBe(1);
    await waitFor(() => test.host().sockets[0]?.closed === true, "the socket close");
    expect(test.timers.pendingReconnects()).toBe(0);
  });
});
