import { admittedWorkOptions } from "./remote-approval.test-support";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { Effect } from "effect";
import {
  encodeHostChannelFrame,
  HOST_CHANNEL_SUBPROTOCOL,
  hostChannelMessageSchema,
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  splitHostChannelFrame,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  type HostChannelMessage,
  type HostChannelRequest,
} from "@openducktor/contracts";
import { createEffectHostCommandRouter } from "../../host/src/interface/router/host-command-router";
import type { TaskAssetReadService } from "../../host/src/application/task-assets/task-asset-read-service";
import { createTaskEventStream } from "../../host/src/events/task-event-stream";
import { createNotificationStream } from "../../host/src/application/notifications/notification-stream";
import { BufferedHostEventBus } from "./host-event-bus";
import { createRemoteWorkInterface, type RemoteHostServices } from "./remote-work-interface";
import { startNodeFetchServer } from "./node-fetch-server";
import { hostWebSocketHandler } from "./host-websocket-handler";

type ChannelMessage = { header: HostChannelMessage; body: string | null };

/** A host channel client on Node's WebSocket. */
const openChannel = async (base: string, connectionId: string, connectionToken: string) => {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/channel`, [
    HOST_CHANNEL_SUBPROTOCOL,
    `${REMOTE_SOCKET_CONNECTION_PREFIX}${connectionId}`,
    `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${connectionToken}`,
  ]);
  socket.binaryType = "arraybuffer";
  const messages: ChannelMessage[] = [];
  const waiters = new Set<() => void>();
  socket.onmessage = (event) => {
    assert.ok(event.data instanceof ArrayBuffer);
    const { header, body } = splitHostChannelFrame(new Uint8Array(event.data));
    messages.push({
      header: hostChannelMessageSchema.parse(JSON.parse(header)),
      body: body === null ? null : new TextDecoder().decode(body),
    });
    // oxlint-disable-next-line unicorn/no-useless-spread -- waiters remove themselves during delivery
    for (const waiter of [...waiters]) waiter();
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  assert.equal(socket.protocol, HOST_CHANNEL_SUBPROTOCOL);
  const until = (check: () => ChannelMessage | undefined) =>
    new Promise<ChannelMessage>((resolve) => {
      const waiter = () => {
        const found = check();
        if (!found) return;
        waiters.delete(waiter);
        resolve(found);
      };
      waiters.add(waiter);
      waiter();
    });
  let nextId = 0;
  return {
    socket,
    request(request: HostChannelRequest) {
      const id = nextId++;
      // The frame is a view of an `ArrayBufferLike`; the socket takes a plain `ArrayBuffer` view.
      socket.send(encodeHostChannelFrame({ type: "request", id, ...request }).slice());
      return until(() =>
        messages.find(
          ({ header }) => (header.type === "result" || header.type === "error") && header.id === id,
        ),
      );
    },
    next(type: HostChannelMessage["type"]) {
      return until(() => messages.find(({ header }) => header.type === type));
    },
  };
};

test("Node listener setup sees its assigned port and closes the socket when setup fails", async () => {
  let port = 0;
  let listener: Awaited<ReturnType<typeof startNodeFetchServer>> | undefined;
  try {
    let failure: unknown;
    try {
      listener = await startNodeFetchServer({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("unexpected"),
        onError: (cause) => {
          throw cause;
        },
        onListening: (server) => {
          port = server.port;
          throw new Error("Work setup failed.");
        },
      });
    } catch (cause) {
      failure = cause;
    }
    assert.match(String(failure), /Work setup failed/);
    assert.ok(port > 0);
    let ready = false;
    const replacement = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port,
      onListening: (server) => {
        assert.equal(server.port, port);
        ready = true;
      },
      fetch: () => {
        assert.equal(ready, true);
        return new Response("ready");
      },
      onError: (cause) => {
        throw cause;
      },
    });
    try {
      assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ready");
    } finally {
      await replacement.stop(true);
    }
  } finally {
    await listener?.stop(true);
  }
});

for (const shell of ["electron", "web"] as const) {
  test(`${shell} serves admitted channel work on Node with retained or stripped prefixes`, async () => {
    const themes: string[] = [];
    const router = createEffectHostCommandRouter({
      handlers: {
        set_theme: (args) =>
          Effect.sync(() => {
            themes.push(String(args?.theme));
          }),
      },
    });
    const notifications = createNotificationStream();
    const work = createRemoteWorkInterface(
      {
        ...router,
        hostInstanceId: "host-body-test",
        hostSettings: {
          readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
          saveRemoteAccessSettings: () => Effect.void,
        },
        taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
        notificationStream: notifications,
        taskAssetReadService: {
          read: () => Effect.succeed(null),
          readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
        } satisfies TaskAssetReadService,
        eventBus: new BufferedHostEventBus({ report: () => {} }),
        get terminalService(): RemoteHostServices["terminalService"] {
          throw new Error("Channel work must not use the terminal service.");
        },
      },
      {
        shell,
        appVersion: "host-test",
        hostId: "20000000-0000-4000-8000-000000000001",
        ...admittedWorkOptions(),
        listenHost: "127.0.0.1",
        publicEndpoint: "https://machine.test/api/remote",
        logger: { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
        reportFailure: (cause) => {
          throw cause;
        },
      },
    );
    const server = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port: 0,
      fetch: work.handle,
      websocket: hostWebSocketHandler,
      onError: (cause) => {
        throw cause;
      },
    });
    try {
      for (const prefix of ["/api/remote", ""]) {
        const base = `http://127.0.0.1:${server.port}${prefix}`;
        // Leave the upload open. The listener must deliver its refusal before the rest arrives.
        for (const declared of ["4194304", undefined]) {
          await new Promise<void>((resolve, reject) => {
            const upload = httpRequest(
              `${base}/connections`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...(declared && { "content-length": declared }),
                },
              },
              (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("error", reject);
                response.on("end", () => {
                  try {
                    assert.equal(response.statusCode, 400);
                    assert.equal(JSON.parse(body).failure.code, "invalid_protocol");
                    assert.match(JSON.parse(body).failure.message, /65536/);
                    assert.equal(response.headers.connection, "close");
                    resolve();
                  } catch (cause) {
                    reject(cause);
                  } finally {
                    upload.destroy();
                  }
                });
              },
            );
            upload.on("error", reject);
            upload.write(" ".repeat(65537));
          });
        }
        const admitted = await fetch(`${base}/connections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientKind: "mobile",
            appVersion: "mobile-test",
            supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
            requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
            optionalCapabilities: [],
          }),
        });
        assert.equal(admitted.status, 201);
        const { connectionId, connectionToken } = await admitted.json();
        const channel = await openChannel(base, connectionId, connectionToken);
        try {
          const opened = await channel.request({
            method: "events.open",
            cursor: null,
            notificationCursor: null,
          });
          assert.equal(opened.header.type, "result");
          await channel.next("notification");
          const command = await channel.request({
            method: "invoke",
            command: "set_theme",
            args: { theme: "dark" },
          });
          assert.equal(command.header.type, "result", JSON.stringify(command.header));
          const subscription = await channel.request({
            method: "task_events.subscribe",
            input: { cursor: null },
          });
          const { subscriptionId, replayBoundary } = JSON.parse(subscription.body ?? "");
          const delivered = await channel.next("task_frame");
          assert.ok(delivered.header.type === "task_frame");
          assert.equal(delivered.header.subscriptionId, subscriptionId);
          assert.deepEqual(delivered.header.frame.cursor, replayBoundary);
          const acknowledged = await channel.request({
            method: "task_events.ack",
            subscriptionId,
            cursor: delivered.header.frame.cursor,
          });
          assert.equal(acknowledged.header.type, "result", JSON.stringify(acknowledged.header));
        } finally {
          channel.socket.close();
        }
        const malformed = await fetch(`${base}/connections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).failure.code, "invalid_protocol");
      }
      assert.deepEqual(themes, ["dark", "dark"]);
    } finally {
      work.close();
      await server.stop(true);
      await Effect.runPromise(notifications.dispose());
    }
  });
}

const collectGarbage = async () => {
  for (let round = 0; round < 5; round++) {
    globalThis.gc?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("closing a channel or a terminal on Node clears the client presence", async () => {
  if (!globalThis.gc) throw new Error("Run this fixture with node --expose-gc.");
  const notifications = createNotificationStream();
  const presence: number[] = [];
  const work = createRemoteWorkInterface(
    {
      ...createEffectHostCommandRouter({ handlers: {} }),
      hostInstanceId: "host-presence-test",
      hostSettings: {
        readRemoteAccessSettings: () => Effect.succeed({ enabled: false, configuration: null }),
        saveRemoteAccessSettings: () => Effect.void,
      },
      taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
      notificationStream: notifications,
      taskAssetReadService: {
        read: () => Effect.succeed(null),
        readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
      } satisfies TaskAssetReadService,
      eventBus: new BufferedHostEventBus({ report: () => {} }),
      // SAFETY: opening and closing a terminal socket attaches no terminal, so no member is used.
      terminalService: {} as RemoteHostServices["terminalService"],
    },
    {
      shell: "web",
      appVersion: "host-test",
      hostId: "20000000-0000-4000-8000-000000000001",
      ...admittedWorkOptions(),
      listenHost: "127.0.0.1",
      publicEndpoint: "http://127.0.0.1:1",
      logger: { error: () => Effect.void, info: () => Effect.void, success: () => Effect.void },
      reportFailure: (cause) => {
        throw cause;
      },
      onClientsChanged: (clients) => presence.push(clients.size),
    },
  );
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: work.handle,
    websocket: hostWebSocketHandler,
    onError: (cause) => {
      throw cause;
    },
  });
  const waitForPresence = async (size: number) => {
    for (let attempt = 0; attempt < 100 && presence.at(-1) !== size; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(presence.at(-1), size);
  };
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const admitted = await fetch(`${base}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientKind: "browser",
        appVersion: "browser-test",
        supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
        requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
        optionalCapabilities: [],
      }),
    });
    assert.equal(admitted.status, 201);
    const { connectionId, connectionToken } = await admitted.json();
    const channel = await openChannel(base, connectionId, connectionToken);
    await waitForPresence(1);
    // An idle channel must keep its close signal after garbage collection.
    await collectGarbage();
    channel.socket.close();
    await waitForPresence(0);

    const terminal = new WebSocket(`ws://127.0.0.1:${server.port}/terminal`, [
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      `${REMOTE_SOCKET_CONNECTION_PREFIX}${connectionId}`,
      `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${connectionToken}`,
    ]);
    await new Promise((resolve, reject) => {
      terminal.onopen = resolve;
      terminal.onerror = reject;
    });
    await waitForPresence(1);
    // The upgrade request ends when the socket opens, so nothing else holds its close signal.
    await collectGarbage();
    terminal.close();
    await waitForPresence(0);
  } finally {
    work.close();
    await server.stop(true);
    await Effect.runPromise(notifications.dispose());
  }
});
