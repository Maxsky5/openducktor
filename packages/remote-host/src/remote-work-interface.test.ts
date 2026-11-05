import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  createFilesystemRemoteApprovalStore,
  type TaskAssetReadResult,
  type TaskAssetReadService,
} from "@openducktor/host";
import { admittedWorkOptions, memoryApprovalStore } from "./remote-approval.test-support";
import { afterAll, expect, spyOn, test } from "bun:test";
import { Effect, Fiber, Stream } from "effect";
import { WebSocket } from "ws";
import { get, type IncomingMessage } from "node:http";
import os from "node:os";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_CONNECTION_HEADER,
  HOST_CHANNEL_HEARTBEAT_INTERVAL_MS,
  HOST_CHANNEL_SUBPROTOCOL,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  TERMINAL_PROTOCOL_VERSION,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  encodeTerminalProtocolFrame,
  decodeTerminalProtocolFrame,
  decodeTerminalListSummary,
  remoteNegotiationResultSchema,
  REMOTE_PROTOCOL_VERSION,
  type RemoteConnectionRequest,
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
import { hostWebSocketHandler } from "./host-websocket-handler";
import { openRemoteChannelClient } from "./host-channel.test-support";
import { createRemoteAccessController } from "./remote-access-controller";
import { createHostCommandLifetime } from "./host-command-lifetime";
import { holdIntervals, holdTimeouts } from "./timers.test-support";

afterAll(removeFakeShell);
const hello: RemoteConnectionRequest = {
  clientKind: "mobile",
  appVersion: "mobile-8",
  supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
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
    hostSettings: {
      readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
      saveRemoteAccessSettings: () => Effect.void,
    },
    terminalService: terminal.service,
    taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
    notificationStream: notifications,
    taskAssetReadService: {
      read: () => Effect.succeed(null),
      readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
    } satisfies TaskAssetReadService,
    eventBus,
  };
  const options = {
    shell: "electron" as const,
    appVersion: "host-3",
    hostId: "20000000-0000-4000-8000-000000000001",
    ...admittedWorkOptions(),
    approvalStore: Effect.succeed(memoryApprovalStore()),
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
    websocket: hostWebSocketHandler,
    onError: () => {},
  });
  const base = `http://127.0.0.1:${server.port}/api/remote`;
  const tokens = new Map<string, string>();
  const remember = (result: { connectionId: string; connectionToken: string }) => {
    tokens.set(result.connectionId, result.connectionToken);
    return result;
  };
  const headers = (id: string) => ({
    [REMOTE_CONNECTION_HEADER]: id,
    authorization: `Bearer ${tokens.get(id) ?? "invalid"}`,
  });
  const negotiate = async (input = hello) => {
    const response = await fetch(`${base}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, clientKind: "mobile" }),
    });
    const result = await response.json();
    if (result.status === "accepted") remember(result);
    return { response, result };
  };
  /** Opens a host channel on an admitted connection. */
  const channel = (id: string, extra: Record<string, string> = {}, at = base) =>
    openRemoteChannelClient(
      at,
      { connectionId: id, connectionToken: tokens.get(id) ?? "invalid" },
      extra,
    );
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
    headers,
    remember,
    options,
    base,
    work,
    server,
    terminal,
    notifications,
    mutations,
    negotiate,
    channel,
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
    const mismatch = await f.negotiate({
      ...hello,
      supportedProtocolVersions: [2],
      pairingCode: "123456",
    });
    expect(mismatch.response.status).toBe(426);
    expect(mismatch.result.failure.updateSide).toBe("client");
    expect(remoteNegotiationResultSchema.safeParse(mismatch.result).success).toBe(true);
    expect(mismatch.result.failure.client.clientKind).toBeUndefined();
    expect(mismatch.result.failure.client.pairingCode).toBeUndefined();
    const missing = await f.negotiate({ ...hello, requiredCapabilities: ["future.required"] });
    expect(missing.result.failure.missingCapabilities[0].name).toBe("future.required");
    const legacy = await f.negotiate({
      ...hello,
      requiredCapabilities: hello.requiredCapabilities.map((name) =>
        name === "terminal.v3" ? "terminal.v2" : name,
      ),
    });
    expect(legacy.result.failure.updateSide).toBe("client");
    expect(legacy.result.failure.nextAction).toContain("client");
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
            ...f.headers(id),
            origin: "https://unrelated.test",
          },
          body: '{"theme":"dark"}',
        })
      ).status,
    ).toBe(403);
    // Commands, events, and task streams use the channel. Their HTTP routes are gone.
    for (const [method, route] of [
      ["POST", "/invoke/set_theme"],
      ["GET", "/events"],
      ["POST", "/task-events/subscriptions"],
    ] as const) {
      const init: RequestInit = {
        method,
        headers: { "content-type": "application/json", ...f.headers(id) },
      };
      if (method === "POST") init.body = "{}";
      const removed = await fetch(`${f.base}${route}`, init);
      expect(removed.status).toBe(409);
      expect(await removed.json()).toMatchObject({ failure: { code: "function_unavailable" } });
    }
    const channel = await f.channel(id);
    try {
      const work = await channel.request({
        method: "invoke",
        command: "set_theme",
        args: { theme: "dark" },
      });
      expect(work.header.type).toBe("result");
      expect(f.mutations).toEqual(["dark"]);
      expect(
        (await channel.request({ method: "invoke", command: "open_external_url", args: {} }))
          .header,
      ).toMatchObject({ error: { kind: "refused", failure: { code: "function_unavailable" } } });
    } finally {
      await channel.close();
    }
    expect(
      (
        await fetch(`${f.base}/shutdown`, {
          method: "POST",
          headers: { ...f.headers(id) },
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
    const channel = await f.channel(id);
    try {
      for (const forceRefresh of [false, true]) {
        const reply = await channel.request({
          method: "invoke",
          command: "system_list_open_in_tools",
          args: { forceRefresh },
        });
        expect(reply.header.type).toBe("result");
        expect(JSON.parse(reply.body ?? "")).toEqual([]);
      }
      expect(
        (
          await channel.request({
            method: "invoke",
            command: "system_list_open_in_tools",
            args: { forceRefresh: "invalid" },
          })
        ).header,
      ).toMatchObject({ error: { kind: "refused", failure: { code: "invalid_protocol" } } });
      expect(
        (
          await channel.request({
            method: "invoke",
            command: "system_open_directory_in_tool",
            args: { directoryPath: "/repo", toolId: "zed" },
          })
        ).header,
      ).toMatchObject({ error: { kind: "refused", failure: { code: "function_unavailable" } } });
    } finally {
      await channel.close();
    }
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    invoke.mockRestore();
    await f.close();
  }
});

test("task leases belong to their negotiated connection and carry the captured replay boundary", async () => {
  const f = await fixture();
  try {
    const first = await f.channel((await f.negotiate()).result.connectionId);
    const second = await f.channel((await f.negotiate()).result.connectionId);
    try {
      const subscribed = await first.request({
        method: "task_events.subscribe",
        input: { cursor: null },
      });
      const lease = JSON.parse(subscribed.body ?? "");
      expect(lease.replayBoundary.sequence).toBe(0);
      for (const request of [
        { method: "task_events.attach", subscriptionId: lease.subscriptionId },
        {
          method: "task_events.ack",
          subscriptionId: lease.subscriptionId,
          cursor: lease.replayBoundary,
        },
      ] as const)
        expect((await second.request(request)).header).toMatchObject({
          error: { kind: "refused", failure: { code: "connection_expired" } },
        });
      // A release from another connection leaves the lease to its owner.
      await second.request({ method: "task_events.release", subscriptionId: lease.subscriptionId });
      expect(
        (
          await first.request({
            method: "task_events.ack",
            subscriptionId: lease.subscriptionId,
            cursor: lease.replayBoundary,
          })
        ).header.type,
      ).toBe("result");
    } finally {
      await first.close();
      await second.close();
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

test("two remote terminal lists receive idle creation and close without output attachments", async () => {
  const f = await fixture();
  const sockets: WebSocket[] = [];
  type Message = ReturnType<typeof decodeTerminalProtocolFrame>["message"];
  const next = (socket: WebSocket, matches: (message: Message, payload: Uint8Array) => boolean) =>
    new Promise<ReturnType<typeof decodeTerminalProtocolFrame>>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error("The remote terminal list did not update."));
      }, 500);
      const receive = (data: import("ws").RawData) => {
        const frame = decodeTerminalProtocolFrame(
          Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : data,
        );
        if (!matches(frame.message, frame.payload)) return;
        clearTimeout(timer);
        socket.off("message", receive);
        resolve(frame);
      };
      socket.on("message", receive);
    });
  try {
    for (const subscriptionId of ["desktop", "mobile"]) {
      const admission = await f.negotiate();
      const socket = new WebSocket(f.base.replace("http:", "ws:") + "/terminal", [
        TERMINAL_PROTOCOL_SUBPROTOCOL,
        `${REMOTE_SOCKET_CONNECTION_PREFIX}${admission.result.connectionId}`,
        `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${admission.result.connectionToken}`,
      ]);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ready = next(socket, (message) => message.type === "list_snapshot_end");
      socket.send(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "observe_list",
            subscriptionId,
            filter: { kind: "task", workspaceId: "repo", repoPath: "/repo", taskId: "task" },
          },
          payload: new Uint8Array(),
        }),
      );
      await ready;
    }
    const updates = sockets.map((socket) =>
      next(
        socket,
        (message, payload) =>
          message.type === "list_updated" &&
          decodeTerminalListSummary(payload).lifecycle === "running",
      ),
    );
    const created = await Effect.runPromise(
      f.terminal.service.create({
        workingDir: "/repo",
        context: { workspaceId: "repo", repoPath: "/repo", taskId: "task" },
      }),
    );
    for (const frame of await Promise.all(updates)) {
      expect(frame.message).toMatchObject({
        type: "list_updated",
      });
      expect(decodeTerminalListSummary(frame.payload)).toMatchObject({
        terminalId: created.ref.terminalId,
        lifecycle: "running",
      });
    }
    expect(f.terminal.pty.operations).toEqual([]);
    const removals = sockets.map((socket) =>
      next(socket, (message) => message.type === "list_removed"),
    );
    await Effect.runPromise(
      f.terminal.service.close({ terminalId: created.ref.terminalId, confirmTerminate: true }),
    );
    for (const frame of await Promise.all(removals))
      expect(frame.message).toMatchObject({
        type: "list_removed",
        terminalId: created.ref.terminalId,
      });
    expect(f.terminal.pty.operations).toEqual(["terminate"]);
  } finally {
    for (const socket of sockets) socket.terminate();
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
        context: { workspaceId: "repo", repoPath: "/repo", taskId: "task" },
      }),
    );
    const id = (await f.negotiate()).result.connectionId;
    const otherTab = await f.negotiate();
    const sharedCookie = `openducktor_remote_connection=${otherTab.result.connectionId}`;
    for (const header of [otherTab.result.connectionId, "expired", ""]) {
      const response = await fetch(`${f.base}/terminal`, {
        headers: {
          ...f.headers(header),
          "sec-websocket-protocol": `${TERMINAL_PROTOCOL_SUBPROTOCOL}, ${REMOTE_SOCKET_CONNECTION_PREFIX}${id}`,
        },
      });
      expect(response.status).toBe(400);
      expect((await response.json()).failure.code).toBe("invalid_protocol");
    }
    socket = new WebSocket(
      f.base.replace("http:", "ws:") + "/terminal",
      [
        TERMINAL_PROTOCOL_SUBPROTOCOL,
        `${REMOTE_SOCKET_CONNECTION_PREFIX}${id}`,
        `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${f.headers(id).authorization.slice(7)}`,
      ],
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
          version: TERMINAL_PROTOCOL_VERSION,
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
      headers: { ...f.headers(id) },
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
    expect(await discovery.json()).toMatchObject({
      hostInstanceId: "host-a",
      hostId: "20000000-0000-4000-8000-000000000001",
    });
    // The configuration names the bound port, so the operator saves the address that clients use.
    expect(state.configuration!.listenPort).toBe(Number(url.port));
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
        body: JSON.stringify({
          ...hello,
          pairingCode: (await Effect.runPromise(controller.startPairing())).pairing!.code,
        }),
      });
      expect(admission.status).toBe(201);
      expect(admission.headers.get("access-control-allow-origin")).toBe(origin);
      const { connectionId, connectionToken } = await admission.json();
      f.remember({ connectionId, connectionToken });
      const channel = await f.channel(connectionId, { origin }, endpoint.replace(/\/$/, ""));
      try {
        const work = await channel.request({
          method: "invoke",
          command: "system_get_platform",
          args: {},
        });
        expect(JSON.parse(work.body ?? "")).toBe("linux");
      } finally {
        await channel.close();
      }
    }
    for (const origin of ["https://unrelated.test", "http://localhost.evil.test:57983"]) {
      const denied = await fetch(`${endpoint}/connections`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          ...hello,
          pairingCode: (await Effect.runPromise(controller.startPairing())).pairing!.code,
        }),
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }
    const admitted = await fetch(`${endpoint}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...hello,
        pairingCode: (await Effect.runPromise(controller.startPairing())).pairing!.code,
      }),
    });
    expect(admitted.status).toBe(201);
    const { connectionId, connectionToken } = await admitted.json();
    f.remember({ connectionId, connectionToken });
    const channel = await f.channel(connectionId, {}, endpoint.replace(/\/$/, ""));
    const response = await channel.request({
      method: "invoke",
      command: "system_get_platform",
      args: {},
    });
    expect(JSON.parse(response.body ?? "")).toBe("linux");
    await channel.close();
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

test("one connection holds at most 32 task leases across its channels", async () => {
  const f = await fixture();
  const id = (await f.negotiate()).result.connectionId;
  const first = await f.channel(id);
  const second = await f.channel(id);
  try {
    const replies = await Promise.all(
      Array.from({ length: 33 }, (_, index) =>
        (index % 2 === 0 ? first : second).request({
          method: "task_events.subscribe",
          input: { cursor: null },
        }),
      ),
    );
    expect(replies.filter(({ header }) => header.type === "result")).toHaveLength(32);
    const refused = replies.filter(({ header }) => header.type === "error");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.header).toMatchObject({
      error: { kind: "refused", failure: { code: "consumer_overflow" } },
    });
  } finally {
    await first.close();
    await second.close();
    await f.close();
  }
});

test("an open channel holds its admission, and closing the last channel arms its expiry", async () => {
  const expiries = holdTimeouts(60_000);
  const idle = expiries.held;
  const f = await fixture();
  try {
    const id = (await f.negotiate()).result.connectionId;
    const first = await f.channel(id);
    const second = await f.channel(id);
    // Task leases have their own expiry. Only the admission timer counts here.
    const admissionTimers = () => idle.size;
    expect(admissionTimers()).toBe(0);
    await first.close();
    expect(admissionTimers()).toBe(0);
    await second.close();
    const deadline = Date.now() + 500;
    while (admissionTimers() !== 1 && Date.now() < deadline) await Bun.sleep(1);
    expect(admissionTimers()).toBe(1);
    for (const expire of idle.values()) expire();
    expect(
      (
        await fetch(`${f.base}/task-assets/workspace/task/spec/asset`, {
          headers: { ...f.headers(id) },
        })
      ).status,
    ).toBe(409);
  } finally {
    await f.close();
    expiries.restore();
  }
});

test("ending the listener leaves accepted channel work under the host command lifetime", async () => {
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
    const channel = await f.channel((await f.negotiate()).result.connectionId);
    const response = channel
      .request({ method: "invoke", command: "set_theme", args: { theme: "dark" } })
      .catch(() => null);
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

test("keeps an idle channel busy with heartbeat messages", async () => {
  const f = await fixture();
  const heartbeats = holdIntervals(HOST_CHANNEL_HEARTBEAT_INTERVAL_MS);
  try {
    const channel = await f.channel((await f.negotiate()).result.connectionId);
    await channel.request({ method: "events.open", cursor: null, notificationCursor: null });
    // With no host event, only the heartbeat keeps messages on the channel.
    for (const beat of heartbeats.held.values()) beat();
    expect((await channel.next("heartbeat")).header).toEqual({ type: "heartbeat" });
    await channel.close();
  } finally {
    heartbeats.restore();
    await f.close();
  }
});

test("refuses a channel upgrade whose tags do not match the connection", async () => {
  const f = await fixture();
  try {
    const id = (await f.negotiate()).result.connectionId;
    const other = (await f.negotiate()).result.connectionId;
    const token = f.headers(id).authorization.slice(7);
    for (const protocols of [
      [
        TERMINAL_PROTOCOL_SUBPROTOCOL,
        `${REMOTE_SOCKET_CONNECTION_PREFIX}${id}`,
        `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`,
      ],
      [HOST_CHANNEL_SUBPROTOCOL, `${REMOTE_SOCKET_CONNECTION_PREFIX}${id}`],
      [
        HOST_CHANNEL_SUBPROTOCOL,
        `${REMOTE_SOCKET_CONNECTION_PREFIX}${other}`,
        `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`,
      ],
    ]) {
      const response = await fetch(`${f.base}/channel`, {
        headers: { "sec-websocket-protocol": protocols.join(", ") },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    const channel = await f.channel(id);
    expect(channel.socket.protocol).toBe(HOST_CHANNEL_SUBPROTOCOL);
    await channel.close();
  } finally {
    await f.close();
  }
});

test("a released admission refuses the work of its open channel", async () => {
  const f = await fixture();
  try {
    const id = (await f.negotiate()).result.connectionId;
    const channel = await f.channel(id);
    await fetch(`${f.base}/connections/current`, { method: "DELETE", headers: f.headers(id) });
    expect(await channel.closed).toMatchObject({ code: 1001 });
  } finally {
    await f.close();
  }
});

test("sharing status counts each live client once and clears clients on disablement", async () => {
  const f = await fixture();
  const controller = createRemoteAccessController(f.services, f.options);
  const channels: Array<Awaited<ReturnType<typeof f.channel>>> = [];
  const observed: Array<number | null> = [];
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
        body: JSON.stringify({
          ...hello,
          pairingCode: (await Effect.runPromise(controller.startPairing())).pairing!.code,
        }),
      });
      const admission = remoteNegotiationResultSchema.parse(await result.json());
      if (admission.status !== "accepted") throw new Error(admission.failure.message);
      f.remember(admission);
      return admission.connectionId;
    };
    const openStream = async (id: string) => {
      const channel = await f.channel(id, {}, base);
      channels.push(channel);
      return { abort: () => void channel.close() };
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
      headers: { ...f.headers(first) },
    });
    await waitForCount(1);
    await Effect.runPromise(controller.disable());
    await waitForCount(0);
    expect(observed.filter((count, index) => index === 0 || observed[index - 1] !== count)).toEqual(
      [null, 0, 1, 2, 1, 2, 1, 0],
    );
  } finally {
    for (const channel of channels) await channel.close();
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
          ...f.services.taskAssetReadService,
          read: () =>
            Effect.promise(async () => {
              started.resolve();
              if (phase === "pending") await gate.promise;
              return {
                bytes: new Uint8Array(8 * 1024 * 1024),
                mediaType: "image/png",
                headers: {
                  "Cache-Control": "no-store, private",
                  "Content-Disposition": "inline",
                  "Content-Type": "image/png",
                  "X-Content-Type-Options": "nosniff",
                },
              } satisfies TaskAssetReadResult;
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
        body: JSON.stringify({
          ...hello,
          pairingCode: (await Effect.runPromise(controller.startPairing())).pairing!.code,
        }),
      });
      const { connectionId, connectionToken } = await negotiation.json();
      f.remember({ connectionId, connectionToken });
      const outcome = Promise.withResolvers<string>();
      const transferStarted = Promise.withResolvers<void>();
      let response: IncomingMessage | undefined;
      const request = get(
        `${base}/task-assets/workspace/task/description/${crypto.randomUUID()}`,
        {
          headers: { ...f.headers(connectionId) },
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
      const privateResponse = await fetch(new URL("/local-work", base), {
        headers: { "x-private": "local" },
      });
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

test("keeps preview bootstrap off the work listener and retains origin checks", async () => {
  const f = await fixture();
  const invoke = spyOn(f.services, "invoke");
  try {
    const response = await fetch(`${f.base}/artifact-preview-bootstrap`);
    expect(response.status).toBe(409);
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

test.each(["electron", "web"] as const)(
  "%s requires pairing, remembers approvals, and revokes all admissions across restart",
  async (shell) => {
    const f = await fixture();
    await f.stopNetwork();
    const root = await mkdtemp(path.join(os.tmpdir(), "odt-secure-host-"));
    const port = Number(new URL(f.base).port);
    const options = {
      ...f.options,
      shell,
      approvalStore: createFilesystemRemoteApprovalStore(root).open({
        shell,
        profile: "default",
      }),
    };
    let controller = createRemoteAccessController(f.services, options);
    const input = {
      listenHost: "127.0.0.1",
      listenPort: port,
      publicEndpoint: f.options.publicEndpoint,
    };
    const submit = async (body: RemoteConnectionRequest, token?: string) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`${f.base}/connections`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: remoteNegotiationResultSchema.parse(await response.json()),
      };
    };
    const channels: Array<Awaited<ReturnType<typeof f.channel>>> = [];
    try {
      expect((await Effect.runPromise(controller.enable(input))).pairing).toBeNull();
      expect((await submit({ ...hello, pairingCode: "123456" })).body).toMatchObject({
        failure: { code: "pairing_refused" },
      });
      const initial = await Effect.runPromise(controller.startPairing());
      expect(initial.pairing?.code).toMatch(/^\d{6}$/);
      const missing = await submit(hello);
      expect(missing).toMatchObject({
        status: 401,
        body: { failure: { code: "authorization_required" } },
      });
      expect((await submit({ ...hello, pairingCode: "wrong" })).body).toMatchObject({
        failure: { code: "pairing_refused" },
      });
      const paired = await submit({ ...hello, pairingCode: initial.pairing!.code });
      if (paired.body.status !== "accepted" || !paired.body.authorization)
        throw new Error("Pairing did not grant authorization.");
      const grant = paired.body.authorization;
      expect((await Effect.runPromise(controller.readState())).pairing).toBeNull();
      expect((await submit({ ...hello, pairingCode: initial.pairing!.code })).body).toMatchObject({
        failure: { code: "pairing_refused" },
      });
      const saved = await submit(hello, grant.token);
      if (saved.body.status !== "accepted") throw new Error("Saved access was refused.");
      expect(saved.body.authorization).toBeUndefined();
      const a = f.headers(f.remember(paired.body).connectionId);
      const b = f.headers(f.remember(saved.body).connectionId);
      expect(
        (
          await fetch(`${f.base}/task-assets/workspace/task/spec/asset`, {
            headers: { [REMOTE_CONNECTION_HEADER]: paired.body.connectionId },
          })
        ).status,
      ).toBe(401);
      for (const admission of [paired.body, saved.body])
        channels.push(await f.channel(admission.connectionId));
      const state = await Effect.runPromise(controller.readState());
      expect(state.connectedClients).toBe(1);
      expect(state.clients).toHaveLength(1);
      expect(state.clients![0]).toMatchObject({ clientId: grant.clientId, status: "connected" });
      // The local operator controls remain unavailable through an admitted remote connection.
      expect((await fetch(`${f.base}/remote-access`, { headers: a })).status).toBe(409);
      const kicked = await Effect.runPromise(controller.revokeClient(grant.clientId));
      expect(kicked.connectedClients).toBe(0);
      expect(kicked.clients).toEqual([]);
      // Revocation closes the channels of the client.
      for (const channel of channels) expect(await channel.closed).toMatchObject({ code: 1001 });
      for (const headers of [a, b])
        expect(
          (await fetch(`${f.base}/task-assets/workspace/task/spec/asset`, { headers })).status,
        ).toBe(409);
      expect((await submit(hello, grant.token)).body).toMatchObject({
        failure: { code: "authorization_rejected" },
      });
      const code = (await Effect.runPromise(controller.startPairing())).pairing!.code;
      const remaining = await submit({ ...hello, pairingCode: code });
      if (remaining.body.status !== "accepted" || !remaining.body.authorization)
        throw new Error("Second pairing failed.");
      await Effect.runPromise(controller.disable());
      expect((await Effect.runPromise(controller.readState())).clients![0]!.status).toBe("offline");
      expect((await Effect.runPromise(controller.readState())).pairing).toBeNull();
      await Effect.runPromise(controller.close());
      controller = createRemoteAccessController(f.services, options);
      await Effect.runPromise(controller.enable(input));
      const restored = await submit(hello, remaining.body.authorization.token);
      expect(restored.body).toMatchObject({ status: "accepted", host: { hostId: grant.hostId } });
      expect((await submit(hello, grant.token)).body).toMatchObject({
        failure: { code: "authorization_rejected" },
      });
      await Effect.runPromise(controller.revokeClient(remaining.body.authorization.clientId));
      expect(await Effect.runPromise(f.services.invoke("system_get_platform", {}))).toBe("linux");
    } finally {
      for (const channel of channels) channel.socket.terminate();
      await Effect.runPromise(controller.close());
      await f.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

/** A controller on the fixture network, with a code submit over HTTP. */
const withPairingController = async (
  body: (input: {
    controller: ReturnType<typeof createRemoteAccessController>;
    submit(
      pairingCode?: string,
      token?: string,
    ): Promise<{
      response: Response;
      body: ReturnType<typeof remoteNegotiationResultSchema.parse>;
    }>;
  }) => Promise<void>,
) => {
  const f = await fixture();
  await f.stopNetwork();
  const controller = createRemoteAccessController(f.services, f.options);
  const submit = async (pairingCode?: string, token?: string) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${f.base}/connections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...hello, pairingCode }),
    });
    return { response, body: remoteNegotiationResultSchema.parse(await response.json()) };
  };
  try {
    await Effect.runPromise(
      controller.enable({
        listenHost: "127.0.0.1",
        listenPort: Number(new URL(f.base).port),
        publicEndpoint: f.options.publicEndpoint,
      }),
    );
    await body({ controller, submit });
  } finally {
    await Effect.runPromise(controller.close());
    await f.close();
  }
};

const otherCode = (code: string) => (code === "000000" ? "111111" : "000000");

test("the right code pairs one device and closes the window as paired", async () => {
  await withPairingController(async ({ controller, submit }) => {
    const window = await Effect.runPromise(controller.startPairing());
    expect(window.pairingEnd).toBeUndefined();
    const paired = (await submit(window.pairing!.code)).body;
    expect(paired).toMatchObject({ status: "accepted", authorization: expect.any(Object) });
    expect(await Effect.runPromise(controller.readState())).toMatchObject({
      pairing: null,
      pairingEnd: "paired",
      clients: [expect.any(Object)],
    });
  });
});

test("five wrong codes close the window, and remembered access still connects", async () => {
  await withPairingController(async ({ controller, submit }) => {
    const first = await Effect.runPromise(controller.startPairing());
    const paired = (await submit(first.pairing!.code)).body;
    if (paired.status !== "accepted" || !paired.authorization) throw new Error("Pairing failed.");
    const window = await Effect.runPromise(controller.startPairing());
    for (let n = 0; n < 5; n++)
      expect((await submit(otherCode(window.pairing!.code))).response.status).toBe(401);
    expect(await Effect.runPromise(controller.readState())).toMatchObject({
      pairing: null,
      pairingEnd: "refused",
    });
    expect((await submit(window.pairing!.code)).body).toMatchObject({
      failure: { code: "pairing_refused" },
    });
    expect((await submit(undefined, paired.authorization.token)).body.status).toBe("accepted");
  });
});

test("Stop pairing refuses the code of the closed window", async () => {
  await withPairingController(async ({ controller, submit }) => {
    const window = await Effect.runPromise(controller.startPairing());
    expect(await Effect.runPromise(controller.stopPairing())).toMatchObject({
      pairing: null,
      pairingEnd: "stopped",
    });
    expect((await submit(window.pairing!.code)).response.status).toBe(401);
    expect((await Effect.runPromise(controller.readState())).clients).toHaveLength(0);
  });
});
