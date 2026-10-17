import { expect, spyOn, test } from "bun:test";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_CONNECTION_HEADER,
  type HostEventEnvelope,
  type NotificationStreamFrame,
  type RemoteHostDescriptor,
  type RemoteClientHello,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  createRemoteHostClient,
  readSse,
  remoteError,
  type RemoteTransport,
  type RemoteHttpResponse,
} from "./index";
const encoder = new TextEncoder();
const hello: RemoteClientHello = {
  appVersion: "mobile-7",
  supportedProtocolVersions: [1],
  requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
  optionalCapabilities: [],
};
const descriptor: RemoteHostDescriptor = {
  shell: "web",
  appVersion: "host-2",
  hostInstanceId: "instance-1",
  accessPolicy: "network_reach",
  protocols: [{ version: 1, capabilities: [...REMOTE_BASELINE_CAPABILITIES] }],
};
const latch = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const json = <T>(value: T, status = 200): RemoteHttpResponse => ({
  status,
  headers: {},
  body: (async function* () {
    if (status !== 204) yield encoder.encode(JSON.stringify(value));
  })(),
});
const frame = <T>(event: string, data: T) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const live = (signal: AbortSignal, prefix: string): RemoteHttpResponse => ({
  status: 200,
  headers: {},
  body: (async function* () {
    yield encoder.encode(prefix);
    await new Promise<never>((_resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  })(),
});
const fixture = () => {
  let mutation: RemoteTransport["request"] | null = null;
  const requests: string[] = [];
  const boundary = { epoch: crypto.randomUUID(), sequence: 4 };
  const transport: RemoteTransport = {
    async request(method, url, headers, signal, body) {
      requests.push(`${method} ${url}`);
      if (url.endsWith("/connections"))
        return json({
          status: "accepted",
          host: descriptor,
          connectionId: crypto.randomUUID(),
          protocolVersion: 1,
          missingOptionalCapabilities: [],
        });
      if (url.endsWith("/events"))
        return live(
          signal,
          frame("replay-complete", { hostChanged: false, gaps: [] }) +
            frame("notification-frame", {
              type: "attached",
              cursor: boundary,
              reason: "new",
              health: [],
            }),
        );
      if (url.endsWith("/task-events/subscriptions"))
        return json({ subscriptionId: crypto.randomUUID(), replayBoundary: boundary });
      if (url.endsWith("/stream"))
        return live(
          signal,
          `: openducktor-ready\n\n${frame("task-frame", { type: "snapshot_required", cursor: boundary, reason: "buffer_gap" })}`,
        );
      if (url.endsWith("/ack") || method === "DELETE") return json(null, 204);
      if (url.includes("/invoke/")) {
        if (mutation) return mutation(method, url, headers, signal, body);
        return json(null);
      }
      return json(descriptor);
    },
    openTerminal: async () => {
      throw new Error("No terminal requested in this fixture.");
    },
  };
  return {
    transport,
    requests,
    boundary,
    setMutation(next: RemoteTransport["request"]) {
      mutation = next;
    },
  };
};

test("applies a finite synchronization barrier and canonicalizes manual addresses", async () => {
  const f = fixture();
  const syncing = latch<void>();
  const applied = latch<void>();
  const statuses: string[] = [];
  const remote = createRemoteHostClient(
    "http://HOST.example:80/remote",
    hello,
    f.transport,
    async () => {
      syncing.resolve();
      await applied.promise;
    },
  );
  remote.subscribeState((state) => statuses.push(state.status));
  try {
    const connection = remote.connect();
    await syncing.promise;
    expect(statuses.at(-1)).toBe("synchronizing");
    applied.resolve();
    await connection;
    expect(statuses.at(-1)).toBe("connected");
    expect(f.requests[0]).toBe("GET http://host.example/remote");
  } finally {
    applied.resolve();
    await remote.disconnect();
  }
});

test.each(["recovery read", "host restart"])(
  "releases the admission after a failed %s",
  async (stage) => {
    const f = fixture();
    f.setMutation(async () => json({ error: "The workspace is no longer available." }, 503));
    if (stage === "host restart") {
      const request = f.transport.request;
      f.transport.request = async (...args) => {
        const response = await request(...args);
        if (args[1].endsWith("/connections"))
          return json({
            status: "accepted",
            host: { ...descriptor, hostInstanceId: "restarted-host" },
            connectionId: crypto.randomUUID(),
            protocolVersion: 1,
            missingOptionalCapabilities: [],
          });
        return response;
      };
    }
    const remote = createRemoteHostClient("https://host.example", hello, f.transport, async () => {
      await remote.client.workspaceGetSettingsSnapshot();
    });
    try {
      const failure = await remote.connect().catch((cause: unknown) => cause);
      expect(failure).toMatchObject({
        failure: { code: stage === "host restart" ? "unavailable" : "synchronization_failed" },
      });
      expect(f.requests).toContain("DELETE https://host.example/connections/current");
    } finally {
      await remote.disconnect();
    }
  },
);

test("a canceled negotiation releases its admission without disturbing the next connection", async () => {
  const f = fixture();
  f.setMutation(async () => json("linux"));
  const admitted = latch<string>();
  const reply = latch<void>();
  const released: string[] = [];
  const request = f.transport.request;
  let first = true;
  f.transport.request = async (...args) => {
    if (args[0] === "DELETE") released.push(args[2][REMOTE_CONNECTION_HEADER]!);
    const response = await request(...args);
    if (!args[1].endsWith("/connections") || !first) return response;
    first = false;
    return {
      ...response,
      body: (async function* () {
        for await (const chunk of response.body) {
          admitted.resolve(JSON.parse(new TextDecoder().decode(chunk)).connectionId);
          await reply.promise;
          yield chunk;
        }
      })(),
    };
  };
  const remote = createRemoteHostClient("https://host.example", hello, f.transport, async () => {});
  const canceled = remote.connect().catch((cause: unknown) => cause);
  try {
    const id = await admitted.promise;
    await remote.disconnect();
    await remote.connect();
    reply.resolve();
    expect(await canceled).toMatchObject({ name: "AbortError" });
    expect(released).toEqual([id]);
    expect(remote.readState().status).toBe("connected");
    expect(await remote.client.systemGetPlatform()).toBe("linux");
  } finally {
    reply.resolve();
    await canceled;
    await remote.disconnect();
  }
});

test("a file transfer can outlast its completed setup deadline", async () => {
  const f = fixture();
  const started = latch<void>();
  const finish = latch<void>();
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const deadlines = new Map<ReturnType<typeof setTimeout>, () => void>();
  const timers = spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    const timer = nativeSetTimeout(callback, delay, ...args);
    if (delay === 10_000) deadlines.set(timer, () => callback(...args));
    return timer;
  });
  const clears = spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    if (timer !== undefined) deadlines.delete(timer);
    nativeClearTimeout(timer);
  });
  const request = f.transport.request;
  f.transport.request = async (...args) => {
    if (!args[1].includes("/local-attachment-preview")) return request(...args);
    return {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: (async function* () {
        started.resolve();
        await finish.promise;
        yield encoder.encode("file contents");
      })(),
    };
  };
  const remote = createRemoteHostClient("https://host.example", hello, f.transport, async () => {});
  try {
    await remote.connect();
    const result = remote
      .readStagedPreview("file.txt", new AbortController().signal)
      .catch((cause: unknown) => cause);
    await started.promise;
    for (const expire of deadlines.values()) expire();
    finish.resolve();
    expect(await result).toMatchObject({ bytes: encoder.encode("file contents") });
  } finally {
    finish.resolve();
    await remote.disconnect();
    for (const timer of deadlines.keys()) nativeClearTimeout(timer);
    timers.mockRestore();
    clears.mockRestore();
  }
});

test.each(["idle", "synchronizing", "disconnected"])(
  "%s state listener errors leave connection and recovery intact",
  async (status) => {
    const f = fixture();
    const retry = latch<() => void>();
    const recovered = latch<void>();
    const original = globalThis.setTimeout;
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, delay, ...args) => {
        const timer = original(callback, delay, ...args);
        if (delay === 500)
          retry.resolve(() => {
            clearTimeout(timer);
            callback(...args);
          });
        return timer;
      },
    );
    const report = spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("The connection view failed.");
    let listening = true;
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    const states: string[] = [];
    try {
      remote.subscribeState((state) => {
        if (listening && state.status === status) throw failure;
      });
      remote.subscribeState((state) => {
        states.push(state.status);
        if (state.status === "connected" && state.generation === 2) recovered.resolve();
      });
      await remote.connect();
      if (status === "disconnected") {
        f.setMutation(async () => {
          throw remoteError("transport_failure", "The connection closed.", "Reconnect.");
        });
        const result = await remote.client.setTheme("dark").catch((cause: unknown) => cause);
        expect(result).toMatchObject({ failure: { code: "outcome_unknown" } });
        (await retry.promise)();
        await recovered.promise;
        expect(remote.readState().generation).toBe(2);
      }
      expect(remote.readState().status).toBe("connected");
      expect(states).toContain(status);
      expect(states.at(-1)).toBe("connected");
      expect(report).toHaveBeenCalledWith(expect.any(String), failure);
    } finally {
      listening = false;
      await remote.disconnect();
      timers.mockRestore();
      report.mockRestore();
    }
  },
);

test.each(["headers", "body"])(
  "slow commands keep their result while waiting for response %s",
  async (stage) => {
    const f = fixture();
    const started = latch<void>();
    const finish = latch<void>();
    const deadlines: Array<() => void> = [];
    const original = globalThis.setTimeout;
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, delay, ...args) => {
        const timer = original(callback, delay, ...args);
        if (delay === 10_000)
          deadlines.push(() => {
            clearTimeout(timer);
            callback(...args);
          });
        return timer;
      },
    );
    let commands = 0;
    f.setMutation(async () => {
      commands += 1;
      if (stage === "headers") {
        started.resolve();
        await finish.promise;
      }
      return {
        status: 200,
        headers: {},
        body: (async function* () {
          if (stage === "body") {
            started.resolve();
            await finish.promise;
          }
          yield encoder.encode("null");
        })(),
      };
    });
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    try {
      await remote.connect();
      deadlines.length = 0;
      const command = remote.client.setTheme("dark").then(
        () => ({ status: "completed" }),
        (cause: unknown) => ({ status: "failed", failure: cause }),
      );
      await started.promise;
      for (const deadline of deadlines) deadline();
      finish.resolve();
      expect(await command).toEqual({ status: "completed" });
      expect(remote.readState().status).toBe("connected");
      expect(commands).toBe(1);
    } finally {
      finish.resolve();
      timers.mockRestore();
      await remote.disconnect();
    }
  },
);

test("disconnect cancels a slow command reply without resending work", async () => {
  const f = fixture();
  const started = latch<void>();
  const finish = latch<void>();
  let commands = 0;
  f.setMutation(async () => {
    commands += 1;
    started.resolve();
    await finish.promise;
    return json(null);
  });
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    hello,
    f.transport,
    async () => {},
  );
  try {
    await remote.connect();
    const command = remote.client.setTheme("dark").catch((cause: unknown) => cause);
    await started.promise;
    await remote.disconnect();
    expect(await command).toMatchObject({ failure: { code: "outcome_unknown" } });
    expect(remote.readState().status).toBe("idle");
    expect(commands).toBe(1);
  } finally {
    finish.resolve();
    await remote.disconnect();
  }
});

test.each(["host", "notification"])(
  "%s listener errors leave delivery and replay intact",
  async (kind) => {
    const f = fixture();
    const request = f.transport.request;
    const attached: NotificationStreamFrame = {
      type: "attached",
      cursor: f.boundary,
      reason: "new",
      health: [],
    };
    const event: HostEventEnvelope = {
      channel: "openducktor://runtime-changed",
      payload: { type: "runtime_impact_changed", runtimeKinds: ["opencode"] },
    };
    const cursor = { hostEpoch: "host-epoch", hostEventId: 17, notificationCursor: f.boundary };
    const payload = kind === "host" ? event : attached;
    let streams = 0;
    let resumedFrom: string | undefined;
    f.transport.request = async (method, url, headers, signal, body) => {
      if (url.endsWith("/events")) {
        streams += 1;
        if (streams === 1)
          return live(
            signal,
            frame("replay-complete", { hostChanged: false, gaps: [] }) +
              `id: ${JSON.stringify(cursor)}\n` +
              frame(kind === "host" ? "host-event" : "notification-frame", payload) +
              (kind === "host" ? frame("notification-frame", attached) : ""),
          );
        resumedFrom = headers["last-event-id"];
      }
      return request(method, url, headers, signal, body);
    };
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    const failure = new Error("The view listener failed.");
    const fail = () => {
      throw failure;
    };
    const received: unknown[] = [];
    const stop =
      kind === "host" ? remote.subscribeHostEvents(fail) : remote.subscribeNotifications(fail);
    if (kind === "host") remote.subscribeHostEvents((value) => received.push(value));
    else remote.subscribeNotifications((value) => received.push(value));
    const statuses: string[] = [];
    remote.subscribeState((state) => statuses.push(state.status));
    const report = spyOn(console, "error").mockImplementation(() => {});
    try {
      await remote.connect();
      expect(remote.readState().status).toBe("connected");
      expect(received).toEqual([payload]);
      expect(report).toHaveBeenCalledWith(expect.any(String), failure);
      expect(streams).toBe(1);
      expect(statuses).not.toContain("disconnected");
      stop();
      await remote.retry();
      expect(resumedFrom).toBe(JSON.stringify(cursor));
      expect(remote.readState().status).toBe("connected");
    } finally {
      await remote.disconnect();
      report.mockRestore();
    }
  },
);

test.each(["asset", "preview"])("%s reads wait for pending admission", async (kind) => {
  const f = fixture();
  const started = latch<void>();
  const admitted = latch<void>();
  const request = f.transport.request;
  const bytes = Uint8Array.of(0, 13, 255);
  let reads = 0;
  f.transport.request = async (method, url, headers, signal, body) => {
    if (url.endsWith("/connections")) {
      started.resolve();
      await admitted.promise;
    }
    if (url.includes("/task-assets/") || url.includes("/local-attachment-preview")) {
      reads += 1;
      expect(headers[REMOTE_CONNECTION_HEADER]).toBeDefined();
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: (async function* () {
          yield bytes;
        })(),
      };
    }
    return request(method, url, headers, signal, body);
  };
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    hello,
    f.transport,
    async () => {},
  );
  let result: ReturnType<typeof remote.readStagedPreview> | undefined;
  remote.subscribeState((state) => {
    if (state.status !== "connecting") return;
    const signal = new AbortController().signal;
    result =
      kind === "asset"
        ? remote.readTaskAsset(
            {
              workspaceId: "workspace",
              taskId: "task",
              scope: "description",
              assetId: "550e8400-e29b-41d4-a716-446655440000",
            },
            signal,
          )
        : remote.readStagedPreview("preview.png", signal);
    void result.catch(() => {});
  });
  try {
    const connection = remote.connect();
    await started.promise;
    expect(reads).toBe(0);
    admitted.resolve();
    await connection;
    expect(result).toBeDefined();
    const resource = await result!;
    expect(resource.bytes).toEqual(bytes);
    expect(resource.headers["content-type"]).toBe("image/png");
    expect(reads).toBe(1);
  } finally {
    admitted.resolve();
    await remote.disconnect();
  }
});

test.each(["view closes", "connection changes", "admission fails"])(
  "a pending resource read stops when %s",
  async (reason) => {
    const f = fixture();
    const started = latch<void>();
    const admitted = latch<void>();
    const request = f.transport.request;
    let reads = 0;
    f.transport.request = async (method, url, headers, signal, body) => {
      if (url.endsWith("/connections")) {
        started.resolve();
        await admitted.promise;
        if (reason === "admission fails")
          return json(
            {
              status: "rejected",
              failure: {
                code: "protocol_mismatch",
                message: "No shared protocol.",
                nextAction: "Update the client.",
              },
            },
            426,
          );
      }
      if (url.includes("/local-attachment-preview")) reads += 1;
      return request(method, url, headers, signal, body);
    };
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    try {
      const connection = remote.connect();
      void connection.catch(() => {});
      await started.promise;
      const view = new AbortController();
      const result = remote.readStagedPreview("preview.png", view.signal).catch((cause) => cause);
      if (reason === "view closes") {
        const closed = new Error("View closed.");
        view.abort(closed);
        expect(await result).toBe(closed);
      } else if (reason === "connection changes") {
        await remote.disconnect();
        admitted.resolve();
        await remote.connect();
        expect(await result).toMatchObject({ name: "AbortError" });
      } else {
        admitted.resolve();
        expect(await result).toMatchObject({ failure: { code: "protocol_mismatch" } });
      }
      admitted.resolve();
      await connection.catch(() => {});
      expect(reads).toBe(0);
    } finally {
      admitted.resolve();
      await remote.disconnect();
    }
  },
);

test("task readiness waits for the captured snapshot acknowledgement and invalidates old handles", async () => {
  const f = fixture();
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    hello,
    f.transport,
    async () => {},
  );
  try {
    await remote.connect();
    const received = latch<TaskEventStreamFrame>();
    const handle = await remote.subscribeTaskStream({ cursor: null }, (value) =>
      received.resolve(value),
    );
    let ready = false;
    void handle.ready.then(
      () => {
        ready = true;
      },
      () => {},
    );
    const initial = await received.promise;
    await Promise.resolve();
    expect(ready).toBe(false);
    await handle.acknowledge(initial.cursor);
    await handle.ready;
    expect(ready).toBe(true);
    await remote.retry();
    await expect(handle.acknowledge(f.boundary)).rejects.toMatchObject({
      failure: { code: "connection_expired" },
    });
  } finally {
    await remote.disconnect();
  }
});

test.each([
  ["lease creation", false],
  ["lease creation", true],
  ["stream attach", false],
  ["stream attach", true],
] as const)(
  "canceling %s releases its lease or reports a failed cleanup",
  async (stage, cleanupFails) => {
    const f = fixture();
    const request = f.transport.request;
    const opening = latch<void>();
    const receipt = latch<void>();
    const cleanupFailure = new Error("Lease deletion failed.");
    f.transport.request = async (method, url, headers, signal, body) => {
      signal.throwIfAborted();
      if (url.endsWith("/stream")) {
        opening.resolve();
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      }
      const response = await request(method, url, headers, signal, body);
      if (stage === "lease creation" && url.endsWith("/task-events/subscriptions")) {
        opening.resolve();
        return {
          ...response,
          body: (async function* () {
            await receipt.promise;
            yield* response.body;
          })(),
        };
      }
      if (method === "DELETE" && url.includes("/task-events/subscriptions/")) {
        expect(signal.aborted).toBe(false);
        if (cleanupFails) throw cleanupFailure;
      }
      return response;
    };
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    const abort = new AbortController();
    try {
      await remote.connect();
      const setup = remote.subscribeTaskStream({ cursor: null }, () => {}, abort.signal);
      void setup.catch(() => {});
      await opening.promise;
      abort.abort();
      receipt.resolve();
      const result = await setup.catch((cause: unknown) => cause);
      if (cleanupFails) {
        expect(result).toBeInstanceOf(AggregateError);
        expect(result).toMatchObject({ errors: [abort.signal.reason, cleanupFailure] });
      } else expect(result).toBe(abort.signal.reason);
      expect(
        f.requests.some((value) =>
          value.startsWith("DELETE https://host.example/remote/task-events/subscriptions/"),
        ),
      ).toBe(true);
      expect(remote.readState().status).toBe("connected");
    } finally {
      abort.abort();
      receipt.resolve();
      await remote.disconnect();
    }
  },
);

test("failed terminal attempts do not report another close when the host disconnects", async () => {
  const f = fixture();
  const failure = new Error("The WebSocket endpoint is unavailable.");
  f.transport.openTerminal = async () => {
    throw failure;
  };
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    hello,
    f.transport,
    async () => {},
  );
  let closed = 0;
  try {
    await remote.connect();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await remote
        .connectTerminal(
          new AbortController().signal,
          () => {},
          () => {
            closed += 1;
          },
        )
        .catch((cause: unknown) => cause);
      expect(result).toBe(failure);
      expect(remote.readState().status).toBe("connected");
    }
    await remote.disconnect();
    expect(closed).toBe(0);
  } finally {
    await remote.disconnect();
  }
});

test.each([200, 503])(
  "a stalled HTTP %s response body fails within the setup deadline",
  async (status) => {
    const scheduled: Array<() => void> = [];
    const original = globalThis.setTimeout;
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, delay, ...args) => {
        if (delay === 10_000)
          scheduled.push(() => {
            callback(...args);
          });
        return original(callback, delay, ...args);
      },
    );
    const signalSeen = latch<AbortSignal>();
    const transport: RemoteTransport = {
      request: async (_method, _url, _headers, signal) => {
        signalSeen.resolve(signal);
        return {
          status,
          headers: {},
          body: (async function* () {
            yield await new Promise<Uint8Array>(() => {});
          })(),
        };
      },
      openTerminal: async () => {
        throw new Error("unused");
      },
    };
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      transport,
      async () => {},
    );
    const statuses: string[] = [];
    remote.subscribeState((state) => statuses.push(state.status));
    try {
      const connection = remote.connect();
      await signalSeen.promise;
      await Promise.resolve();
      scheduled[0]!();
      let failure: unknown;
      try {
        await connection;
      } catch (cause) {
        failure = cause;
      }
      expect(failure).toMatchObject({ failure: { code: "transport_failure" } });
      expect(statuses.at(-1)).toBe("disconnected");
    } finally {
      timers.mockRestore();
      await remote.disconnect();
    }
  },
);

test("a sent mutation with a typed transport failure reports an uncertain result without resending", async () => {
  const f = fixture();
  let sent = 0;
  f.setMutation(async () => {
    sent += 1;
    throw remoteError("transport_failure", "Reply was lost.", "Reconnect.");
  });
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    hello,
    f.transport,
    async () => {},
  );
  try {
    await remote.connect();
    await expect(remote.client.setTheme("dark")).rejects.toMatchObject({
      failure: { code: "outcome_unknown" },
    });
    expect(sent).toBe(1);
  } finally {
    await remote.disconnect();
  }
});

test.each(["discovery", "event stream"])(
  "malformed %s stops automatic negotiation",
  async (kind) => {
    const f = fixture();
    const request = f.transport.request;
    f.transport.request = async (method, url, headers, signal, body) =>
      kind === "discovery"
        ? json({ wrong: true })
        : url.endsWith("/events")
          ? live(signal, "event: replay-complete\ndata: {broken}\n\n")
          : request(method, url, headers, signal, body);
    const states: string[] = [];
    const remote = createRemoteHostClient(
      "https://host.example/remote",
      hello,
      f.transport,
      async () => {},
    );
    remote.subscribeState((state) => states.push(state.status));
    try {
      await expect(remote.connect()).rejects.toMatchObject({
        failure: { code: "invalid_protocol" },
      });
      expect(states.at(-1)).toBe("failed");
    } finally {
      await remote.disconnect();
    }
  },
);

test("SSE parsing keeps incremental UTF-8 and mixed line endings without EventSource", async () => {
  const bytes = encoder.encode("id: 4\r\nevent: changed\r\ndata: café\r\ndata: second\r\n\r\n");
  const body = (async function* () {
    for (const byte of bytes) yield Uint8Array.of(byte);
  })();
  const frames = [];
  for await (const value of readSse(body, new AbortController().signal)) frames.push(value);
  expect(frames).toEqual([{ id: "4", event: "changed", data: "café\nsecond" }]);
});

test("a stalled initial task stream ends the synchronization generation", async () => {
  const f = fixture();
  const originalRequest = f.transport.request;
  const scheduled: Array<() => void> = [];
  const originalTimer = globalThis.setTimeout;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    if (delay === 10_000) scheduled.push(() => callback(...args));
    return originalTimer(callback, delay, ...args);
  });
  const taskStarted = latch<void>();
  f.transport.request = async (method, url, headers, signal, body) => {
    if (url.endsWith("/stream")) {
      taskStarted.resolve();
      return {
        status: 200,
        headers: {},
        body: (async function* () {
          yield await new Promise<Uint8Array>(() => {});
        })(),
      };
    }
    return originalRequest(method, url, headers, signal, body);
  };
  let remote: ReturnType<typeof createRemoteHostClient>;
  remote = createRemoteHostClient("https://host.example/remote", hello, f.transport, async () => {
    const handle = await remote.subscribeTaskStream({ cursor: null }, () => {});
    await handle.ready;
  });
  try {
    const connection = remote.connect();
    await taskStarted.promise;
    // Allow the stream headers and owner to install their establishment deadline.
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    scheduled.at(-1)!();
    await expect(connection).rejects.toMatchObject({ failure: { code: "transport_failure" } });
  } finally {
    timers.mockRestore();
    await remote.disconnect();
  }
});
