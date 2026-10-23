import { afterAll, expect, spyOn, test } from "bun:test";
import { Effect, Fiber, Stream } from "effect";
import { WebSocket } from "ws";
import { get, type IncomingMessage } from "node:http";
import os from "node:os";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_CONNECTION_HEADER,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  REMOTE_TERMINAL_CONNECTION_PREFIX,
  encodeTerminalProtocolFrame,
  decodeTerminalProtocolFrame,
  remoteNegotiationResultSchema,
  type RemoteClientHello,
} from "@openducktor/contracts";
import { createEffectHostCommandRouter } from "../../host/src/interface/router/host-command-router";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import {
  makeService,
  removeFakeShell,
} from "../../host/src/application/terminals/test-support/terminal-service-harness";
import { BufferedHostEventBus } from "./host-event-bus";
import { createRemoteWorkInterface } from "./remote-work-interface";
import { startNodeFetchServer } from "./node-fetch-server";
import { terminalWebSocketHandler } from "./terminals/terminal-websocket-handler";
import { createRemoteAccessController } from "./remote-access-controller";
import { createHostCommandLifetime } from "./host-command-lifetime";

afterAll(removeFakeShell);
const hello: RemoteClientHello = {
  appVersion: "mobile-8",
  supportedProtocolVersions: [2],
  requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
  optionalCapabilities: ["future.optional"],
};
type MutationBarrier = { started(): void; gate: Promise<void> };
const fixture = async (barrier?: MutationBarrier) => {
  const terminal = await makeService();
  const notifications = createNotificationStream();
  const eventBus = new BufferedHostEventBus({ report: () => {} });
  const mutations: string[] = [];
  const router = createEffectHostCommandRouter({
    handlers: {
      system_get_platform: () => Effect.succeed("linux"),
      system_list_open_in_tools: () => Effect.succeed([{ toolId: "zed" }]),
      set_theme: (args) =>
        Effect.promise(async () => {
          barrier?.started();
          if (barrier) await barrier.gate;
          mutations.push(String(args?.theme));
        }),
    },
  });
  const commands = createHostCommandLifetime(router);
  const services = {
    ...router,
    invoke: commands.invoke,
    hostInstanceId: "host-a",
    terminalService: terminal.service,
    taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
    notificationStream: notifications,
    taskAssetReadService: { read: () => Effect.succeed(null) },
    eventBus,
  };
  const options = {
    shell: "electron" as const,
    appVersion: "host-3",
    listenHost: "127.0.0.1",
    publicEndpoint: "https://machine.test/api/remote",
    logger: { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
    reportFailure: () => {},
  };
  const work = createRemoteWorkInterface(services, options);
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: work.handle,
    websocket: terminalWebSocketHandler,
    onError: () => {},
  });
  const base = `http://127.0.0.1:${server.port}/api/remote`;
  const negotiate = async (input = hello) => {
    const response = await fetch(`${base}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return { response, result: await response.json() };
  };
  let stopped = false;
  const stopNetwork = async () => {
    if (stopped) return;
    stopped = true;
    work.close();
    await server.stop(true);
  };
  return {
    commands,
    stopNetwork,
    services,
    options,
    base,
    work,
    server,
    terminal,
    notifications,
    mutations,
    negotiate,
    close: async () => {
      await stopNetwork();
      await Effect.runPromise(commands.drain());
      await Effect.runPromise(terminal.service.dispose());
      await Effect.runPromise(notifications.dispose());
    },
  };
};

test("negotiates across app releases and refuses bypass, origins, missing capabilities and expired headers", async () => {
  const f = await fixture();
  try {
    expect(
      (
        await fetch(`${f.base}/invoke/set_theme`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"theme":"dark"}',
        })
      ).status,
    ).toBe(409);
    const mismatch = await f.negotiate({ ...hello, supportedProtocolVersions: [1] });
    expect(mismatch.response.status).toBe(426);
    expect(mismatch.result.failure.updateSide).toBe("client");
    const missing = await f.negotiate({ ...hello, requiredCapabilities: ["future.required"] });
    expect(missing.result.failure.missingCapabilities[0].name).toBe("future.required");
    const accepted = await f.negotiate();
    expect(accepted.result.host.shell).toBe("electron");
    expect(accepted.result.missingOptionalCapabilities).toEqual(["future.optional"]);
    const id = accepted.result.connectionId;
    const cookie = `openducktor_remote_connection=${id}`;
    expect(
      (
        await fetch(`${f.base}/invoke/set_theme`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: '{"theme":"dark"}',
        })
      ).status,
    ).toBe(409);
    expect(accepted.response.headers.has("set-cookie")).toBe(false);
    expect(
      (
        await fetch(`${f.base}/invoke/set_theme`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [REMOTE_CONNECTION_HEADER]: "expired",
            cookie,
          },
          body: '{"theme":"dark"}',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${f.base}/invoke/set_theme`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [REMOTE_CONNECTION_HEADER]: id,
            origin: "https://unrelated.test",
          },
          body: '{"theme":"dark"}',
        })
      ).status,
    ).toBe(403);
    const work = await fetch(`${f.base}/invoke/set_theme`, {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: id },
      body: '{"theme":"dark"}',
    });
    expect(work.status).toBe(200);
    expect(f.mutations).toEqual(["dark"]);
    expect(
      (
        await fetch(`${f.base}/invoke/open_external_url`, {
          method: "POST",
          headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: id },
          body: "{}",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${f.base}/shutdown`, {
          method: "POST",
          headers: { [REMOTE_CONNECTION_HEADER]: id },
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
  }
});

test("remote Open In discovery stays empty while local discovery lists host tools", async () => {
  const f = await fixture();
  const invoke = spyOn(f.services, "invoke");
  try {
    expect(await Effect.runPromise(f.services.invoke("system_list_open_in_tools", {}))).toEqual([
      { toolId: "zed" },
    ]);
    const id = (await f.negotiate()).result.connectionId;
    const headers = { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: id };
    for (const forceRefresh of [false, true]) {
      const response = await fetch(`${f.base}/invoke/system_list_open_in_tools`, {
        method: "POST",
        headers,
        body: JSON.stringify({ forceRefresh }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    const invalid = await fetch(`${f.base}/invoke/system_list_open_in_tools`, {
      method: "POST",
      headers,
      body: '{"forceRefresh":"invalid"}',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ failure: { code: "invalid_protocol" } });
    const launch = await fetch(`${f.base}/invoke/system_open_directory_in_tool`, {
      method: "POST",
      headers,
      body: '{"directoryPath":"/repo","toolId":"zed"}',
    });
    expect(launch.status).toBe(409);
    expect(await launch.json()).toMatchObject({ failure: { code: "function_unavailable" } });
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    invoke.mockRestore();
    await f.close();
  }
});

test("task leases belong to their negotiated connection and carry the captured replay boundary", async () => {
  const f = await fixture();
  try {
    const first = (await f.negotiate()).result.connectionId;
    const second = (await f.negotiate()).result.connectionId;
    const response = await fetch(`${f.base}/task-events/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: first },
      body: '{"cursor":null}',
    });
    const lease = await response.json();
    expect(lease.replayBoundary.sequence).toBe(0);
    for (const [suffix, method] of [
      ["/stream", "GET"],
      ["/ack", "POST"],
      ["", "DELETE"],
    ] as const) {
      const init: RequestInit = {
        method,
        headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: second },
      };
      if (method === "POST") init.body = JSON.stringify({ cursor: lease.replayBoundary });
      expect(
        (await fetch(`${f.base}/task-events/subscriptions/${lease.subscriptionId}${suffix}`, init))
          .status,
      ).toBe(409);
    }
    expect(
      (
        await fetch(`${f.base}/task-assets/workspace/task/spec/asset`, {
          headers: { [REMOTE_CONNECTION_HEADER]: "expired" },
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
  }
});

test("remote terminal attachment uses the local PTY and closes only its client when admission ends", async () => {
  const f = await fixture();
  let socket: WebSocket | null = null;
  try {
    await Effect.runPromise(
      f.terminal.service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task" },
      }),
    );
    const id = (await f.negotiate()).result.connectionId;
    const otherTab = await f.negotiate();
    const sharedCookie = `openducktor_remote_connection=${otherTab.result.connectionId}`;
    for (const header of [otherTab.result.connectionId, "expired", ""]) {
      const response = await fetch(`${f.base}/terminal`, {
        headers: {
          [REMOTE_CONNECTION_HEADER]: header,
          "sec-websocket-protocol": `${TERMINAL_PROTOCOL_SUBPROTOCOL}, ${REMOTE_TERMINAL_CONNECTION_PREFIX}${id}`,
        },
      });
      expect(response.status).toBe(400);
      expect((await response.json()).failure.code).toBe("invalid_protocol");
    }
    socket = new WebSocket(
      f.base.replace("http:", "ws:") + "/terminal",
      [TERMINAL_PROTOCOL_SUBPROTOCOL, `${REMOTE_TERMINAL_CONNECTION_PREFIX}${id}`],
      { headers: { cookie: sharedCookie } },
    );
    const opened = new Promise<void>((resolve, reject) => {
      socket!.once("open", resolve);
      socket!.once("error", reject);
    });
    await opened;
    expect(socket.protocol).toBe(TERMINAL_PROTOCOL_SUBPROTOCOL);
    const snapshot = new Promise<void>((resolve, reject) => {
      socket!.on("message", (data) => {
        try {
          if (
            decodeTerminalProtocolFrame(
              Array.isArray(data)
                ? Buffer.concat(data)
                : data instanceof ArrayBuffer
                  ? new Uint8Array(data)
                  : data,
            ).message.type === "snapshot"
          )
            resolve();
        } catch (cause) {
          reject(cause);
        }
      });
    });
    socket.send(
      encodeTerminalProtocolFrame({
        message: {
          version: 2,
          type: "attach",
          terminalId: "terminal-1",
          lastConsumedSequence: null,
        },
        payload: new Uint8Array(),
      }),
    );
    await snapshot;
    expect(f.terminal.pty.launches).toHaveLength(1);
    const closed = new Promise<void>((resolve) => socket!.once("close", () => resolve()));
    await fetch(`${f.base}/connections/current`, {
      method: "DELETE",
      headers: { [REMOTE_CONNECTION_HEADER]: id },
    });
    await closed;
    expect(
      (await Effect.runPromise(f.terminal.service.list({ kind: "all" }))).terminals,
    ).toHaveLength(1);
    expect(f.terminal.pty.operations).not.toContain("terminate");
  } finally {
    socket?.terminate();
    await f.close();
  }
});

test("a failed listener leaves local host work usable", async () => {
  const f = await fixture();
  const controller = createRemoteAccessController(f.services, f.options);
  try {
    const result = await Effect.runPromise(
      Effect.result(
        controller.enable({
          listenHost: "127.0.0.1",
          listenPort: Number(new URL(f.base).port),
          publicEndpoint: f.options.publicEndpoint,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(await Effect.runPromise(controller.readState())).toMatchObject({
      status: "failed",
      configuration: {
        listenHost: "127.0.0.1",
        listenPort: Number(new URL(f.base).port),
        publicEndpoint: f.options.publicEndpoint,
      },
    });
    expect(await Effect.runPromise(f.services.invoke("system_get_platform"))).toBe("linux");
  } finally {
    await Effect.runPromise(controller.close());
    await f.close();
  }
});

test("automatic setup advertises the bound port and serves work without a manual endpoint", async () => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && !entry.internal && entry.family === "IPv4")?.address;
  if (!address) throw new Error("This HTTP test needs a non-loopback IPv4 network.");
  const f = await fixture();
  const controller = createRemoteAccessController(f.services, f.options);
  try {
    const state = await Effect.runPromise(
      controller.enable({
        listenHost: address,
        listenPort: 0,
        webOrigins: ["https://custom-client.test"],
      }),
    );
    expect(state.status).toBe("available");
    const endpoint = state.configuration!.publicEndpoint;
    const url = new URL(endpoint);
    expect(url.hostname).toBe(address);
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname).toBe("/");
    const discovery = await fetch(endpoint);
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({ hostInstanceId: "host-a" });
    expect(state.configuration!.listenPort).toBe(0);
    for (const origin of [
      "https://app.openducktor.dev",
      "https://custom-client.test",
      "http://localhost:57983",
      "http://127.0.0.1:59466",
      "null",
    ]) {
      const preflight = await fetch(`${endpoint}/connections`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      expect(preflight.headers.get("access-control-max-age")).toBe("600");
      const admission = await fetch(`${endpoint}/connections`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      expect(admission.status).toBe(201);
      expect(admission.headers.get("access-control-allow-origin")).toBe(origin);
      const { connectionId } = await admission.json();
      const work = await fetch(`${endpoint}/invoke/system_get_platform`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          [REMOTE_CONNECTION_HEADER]: connectionId,
        },
        body: "{}",
      });
      expect(work.status).toBe(200);
      expect(await work.json()).toBe("linux");
    }
    for (const origin of ["https://unrelated.test", "http://localhost.evil.test:57983"]) {
      const denied = await fetch(`${endpoint}/connections`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }
    const admitted = await fetch(`${endpoint}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(hello),
    });
    expect(admitted.status).toBe(201);
    const { connectionId } = await admitted.json();
    const response = await fetch(`${endpoint}/invoke/system_get_platform`, {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: connectionId },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBe("linux");
    await Effect.runPromise(controller.disable());
    expect((await Effect.runPromise(controller.readState())).status).toBe("disabled");
    const replacement = await startNodeFetchServer({
      hostname: address,
      port: Number(url.port),
      fetch: () => new Response("released"),
      onError: (cause) => {
        throw cause;
      },
    });
    await replacement.stop(true);
  } finally {
    await Effect.runPromise(controller.close());
    await f.close();
  }
});

test("network choices exclude loopback and scoped link-local addresses and keep IPv6-only networks", async () => {
  const interfaces = spyOn(os, "networkInterfaces").mockReturnValue({
    lo: [
      {
        address: "127.0.0.1",
        internal: true,
        family: "IPv4",
        netmask: "255.0.0.0",
        mac: "00:00:00:00:00:00",
        cidr: "127.0.0.1/8",
      },
    ],
    wifi: [
      {
        address: "fe80::1",
        internal: false,
        family: "IPv6",
        scopeid: 4,
        netmask: "ffff:ffff:ffff:ffff::",
        mac: "00:00:00:00:00:01",
        cidr: "fe80::1/64",
      },
      {
        address: "192.168.1.9",
        internal: false,
        family: "IPv4",
        netmask: "255.255.255.0",
        mac: "00:00:00:00:00:01",
        cidr: "192.168.1.9/24",
      },
    ],
    ipv6: [
      {
        address: "fd00::2",
        internal: false,
        family: "IPv6",
        scopeid: 0,
        netmask: "ffff:ffff:ffff:ffff::",
        mac: "00:00:00:00:00:02",
        cidr: "fd00::2/64",
      },
    ],
  });
  const f = await fixture();
  const controller = createRemoteAccessController(f.services, f.options);
  try {
    expect(await Effect.runPromise(controller.readNetworks())).toEqual([
      { name: "wifi", address: "192.168.1.9" },
      { name: "ipv6", address: "fd00::2" },
    ]);
    interfaces.mockImplementation(() => {
      throw new Error("Network list failed.");
    });
    const result = await Effect.runPromise(Effect.result(controller.readNetworks()));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure.failure.message).toContain("Network list failed.");
  } finally {
    interfaces.mockRestore();
    await Effect.runPromise(controller.close());
    await f.close();
  }
});

test("concurrent subscription bodies cannot exceed one connection's 32 lease limit", async () => {
  const f = await fixture();
  try {
    const id = (await f.negotiate()).result.connectionId;
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    const pending = Array.from({ length: 64 }, () =>
      f.work.handle(
        new Request(`${f.base}/task-events/subscriptions`, {
          method: "POST",
          headers: {
            host: new URL(f.base).host,
            "content-type": "application/json",
            [REMOTE_CONNECTION_HEADER]: id,
          },
          body: new ReadableStream<Uint8Array>({
            start: (controller) => {
              bodies.push(controller);
            },
          }),
          duplex: "half",
        }),
        f.server,
      ),
    );
    for (const body of bodies) {
      body.enqueue(new TextEncoder().encode('{"cursor":null}'));
      body.close();
    }
    const responses = await Promise.all(pending);
    expect(responses.filter((response) => response?.status === 201)).toHaveLength(32);
    const refused = responses.filter((response) => response?.status === 409);
    expect(refused).toHaveLength(32);
    expect(await refused[0]!.json()).toMatchObject({ failure: { code: "consumer_overflow" } });
  } finally {
    await f.close();
  }
});

test("normal task stream replacement and deletion release idle admission ownership", async () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const idle = new Map<ReturnType<typeof setTimeout>, () => void>();
  const timers = spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    const timer = originalSet(callback, delay, ...args);
    if (delay === 60_000) idle.set(timer, () => callback(...args));
    return timer;
  });
  const clears = spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    if (timer !== undefined) idle.delete(timer);
    originalClear(timer);
  });
  const f = await fixture();
  try {
    const id = (await f.negotiate()).result.connectionId;
    const headers = { [REMOTE_CONNECTION_HEADER]: id };
    const response = await fetch(`${f.base}/task-events/subscriptions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: '{"cursor":null}',
    });
    const lease = await response.json();
    const url = `${f.base}/task-events/subscriptions/${lease.subscriptionId}`;
    const first = await fetch(`${url}/stream`, { headers });
    const firstEnded = first.text();
    const second = await fetch(`${url}/stream`, { headers });
    await firstEnded;
    expect(idle.size).toBe(0);
    const secondEnded = second.text();
    await fetch(url, { method: "DELETE", headers });
    await secondEnded;
    expect(idle.size).toBe(1);
    for (const expire of idle.values()) expire();
    expect(
      (
        await fetch(`${f.base}/invoke/system_get_platform`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
    timers.mockRestore();
    clears.mockRestore();
  }
});

test("ending the listener leaves accepted HTTP work under the host command lifetime", async () => {
  let begin!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({ started: begin, gate });
  try {
    const id = (await f.negotiate()).result.connectionId;
    const response = fetch(`${f.base}/invoke/set_theme`, {
      method: "POST",
      headers: { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: id },
      body: '{"theme":"dark"}',
    }).catch(() => null);
    await started;
    await f.stopNetwork();
    let drained = false;
    const drain = Effect.runPromise(f.commands.drain()).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await response;
    await drain;
    expect(f.mutations).toEqual(["dark"]);
    expect(drained).toBe(true);
  } finally {
    release();
    await f.close();
  }
});

test("sharing status counts each live client once and clears clients on disablement", async () => {
  const f = await fixture();
  const controller = createRemoteAccessController(f.services, f.options);
  const requests: AbortController[] = [];
  const streams: Response[] = [];
  const observed: number[] = [];
  const observer = Effect.runFork(
    Stream.runForEach(controller.states, (state) =>
      Effect.sync(() => {
        observed.push(state.connectedClients);
      }),
    ),
  );
  const count = () =>
    Effect.runPromise(controller.readState()).then((state) => state.connectedClients);
  const waitForCount = async (expected: number) => {
    const deadline = Date.now() + 500;
    while (((await count()) !== expected || observed.at(-1) !== expected) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await count()).toBe(expected);
    expect(observed.at(-1)).toBe(expected);
  };
  try {
    const port = Number(new URL(f.base).port);
    await f.stopNetwork();
    expect(await count()).toBe(0);
    await Effect.runPromise(
      controller.enable({
        listenHost: "127.0.0.1",
        listenPort: port,
        publicEndpoint: f.options.publicEndpoint,
      }),
    );
    const base = `http://127.0.0.1:${port}/api/remote`;
    const connect = async () => {
      const result = await fetch(`${base}/connections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      const admission = remoteNegotiationResultSchema.parse(await result.json());
      if (admission.status !== "accepted") throw new Error(admission.failure.message);
      return admission.connectionId;
    };
    const openStream = async (id: string) => {
      const abort = new AbortController();
      requests.push(abort);
      const response = await fetch(`${base}/events`, {
        headers: { [REMOTE_CONNECTION_HEADER]: id },
        signal: abort.signal,
      });
      streams.push(response);
      expect(response.status).toBe(200);
      return abort;
    };
    const first = await connect();
    expect(await count()).toBe(0);
    const firstStream = await openStream(first);
    await waitForCount(1);
    const secondStream = await openStream(first);
    expect(await count()).toBe(1);
    firstStream.abort();
    expect(await count()).toBe(1);
    const second = await connect();
    await openStream(second);
    await waitForCount(2);
    secondStream.abort();
    await waitForCount(1);
    await openStream(first);
    await waitForCount(2);
    await fetch(`${base}/connections/current`, {
      method: "DELETE",
      headers: { [REMOTE_CONNECTION_HEADER]: first },
    });
    await waitForCount(1);
    await Effect.runPromise(controller.disable());
    await waitForCount(0);
    expect(observed.filter((count, index) => index === 0 || observed[index - 1] !== count)).toEqual(
      [0, 1, 2, 1, 2, 1, 0],
    );
  } finally {
    for (const request of requests) request.abort();
    for (const response of streams) await response.body?.cancel().catch(() => {});
    await Effect.runPromise(Fiber.interrupt(observer));
    await Effect.runPromise(controller.close());
    await f.close();
  }
});

test.each(["pending", "transferring"])(
  "shared disablement ends remote resource delivery while %s",
  async (phase) => {
    const f = await fixture();
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let shared!: Awaited<ReturnType<typeof startNodeFetchServer>>;
    const controller = createRemoteAccessController(
      {
        ...f.services,
        taskAssetReadService: {
          read: () =>
            Effect.promise(async () => {
              started.resolve();
              if (phase === "pending") await gate.promise;
              return {
                bytes: new Uint8Array(8 * 1024 * 1024),
                headers: { "content-type": "application/octet-stream" },
              };
            }),
        },
      },
      {
        ...f.options,
        sharedListener: {
          listenHost: "127.0.0.1",
          listenPort: () => shared.port,
          isPrivateRequest: (request) => request.headers.has("x-private"),
        },
      },
    );
    try {
      shared = await startNodeFetchServer({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request, server) =>
          controller.handleSharedRequest(request, server) ?? new Response("private"),
        onError: () => {},
      });
      const base = `http://127.0.0.1:${shared.port}/api/remote`;
      await Effect.runPromise(
        controller.enable({
          listenHost: "127.0.0.1",
          listenPort: shared.port,
          publicEndpoint: f.options.publicEndpoint,
        }),
      );
      const negotiation = await fetch(`${base}/connections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hello),
      });
      const { connectionId } = await negotiation.json();
      const outcome = Promise.withResolvers<string>();
      const transferStarted = Promise.withResolvers<void>();
      let response: IncomingMessage | undefined;
      const request = get(
        `${base}/task-assets/workspace/task/description/${crypto.randomUUID()}`,
        {
          headers: { [REMOTE_CONNECTION_HEADER]: connectionId },
        },
        (incoming) => {
          response = incoming;
          incoming.once("data", () => {
            if (phase === "transferring") incoming.pause();
            transferStarted.resolve();
          });
          incoming.once("end", () => outcome.resolve(`delivered ${incoming.statusCode}`));
          incoming.once("aborted", () => outcome.resolve("closed"));
          incoming.once("error", () => outcome.resolve("closed"));
        },
      );
      request.once("error", () => outcome.resolve("closed"));
      await started.promise;
      if (phase === "transferring") await transferStarted.promise;
      await Effect.runPromise(controller.disable());
      gate.resolve();
      response?.resume();
      expect(await outcome.promise).toBe("closed");
      request.destroy();
      const privateResponse = await fetch(base, { headers: { "x-private": "local" } });
      expect(await privateResponse.text()).toBe("private");
      expect((await fetch(base)).status).toBe(503);
    } finally {
      gate.resolve();
      await Effect.runPromise(controller.close());
      await shared?.stop(true);
      await f.close();
    }
  },
);

test("serves only the constant preview bootstrap before connection admission and retains origin checks", async () => {
  const f = await fixture();
  const invoke = spyOn(f.services, "invoke");
  try {
    const response = await fetch(`${f.base}/artifact-preview-bootstrap`);
    expect(response.status).toBe(200);
    expect(response.headers.get("connection-allowlist")).toBe("()");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("permissions-policy")).toContain("clipboard-read=()");
    expect((await fetch(`${f.base}/artifact-preview-bootstrap?artifactId=private`)).status).toBe(
      409,
    );
    expect(
      (
        await fetch(`${f.base}/artifact-preview-bootstrap`, {
          headers: { origin: "https://unrelated.test" },
        })
      ).status,
    ).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    invoke.mockRestore();
    await f.close();
  }
});
