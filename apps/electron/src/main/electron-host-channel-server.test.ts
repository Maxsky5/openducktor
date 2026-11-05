import { afterEach, expect, test } from "bun:test";
import {
  encodeHostChannelFrame,
  HOST_CHANNEL_SUBPROTOCOL,
  hostChannelMessageSchema,
  hostEventsOpenedSchema,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  splitHostChannelFrame,
} from "@openducktor/contracts";
import { createHostChannelSocketData } from "@openducktor/remote-host/host-channel";
import { BufferedHostEventStream } from "@openducktor/remote-host/host-event-bus";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";
import { Effect } from "effect";
import { request as httpRequest } from "node:http";
import WebSocket from "ws";
import { createNotificationStream } from "../../../../packages/host/src/application/notifications/notification-stream";
import { createTaskEventStream } from "../../../../packages/host/src/events/task-event-stream";
import { resolveElectronRendererSocketOrigins } from "./electron-loopback-cors-policy";
import {
  startElectronHostChannelServer,
  type ElectronHostChannelServer,
} from "./electron-host-channel-server";

const RENDERER_ORIGIN = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A started desktop channel server with real host event, notification, and task streams. */
const startServer = async (
  rendererOrigins: ReadonlySet<string> = new Set([RENDERER_ORIGIN]),
): Promise<ElectronHostChannelServer> => {
  const notifications = createNotificationStream();
  const leases = createTaskEventLeaseManager({
    taskEventStream: createTaskEventStream({ reporter: { report: () => {} } }),
    reportDeliveryFailure: () => {},
  });
  const server = await startElectronHostChannelServer({
    rendererOrigins,
    onError: () => {},
    createChannel: () =>
      createHostChannelSocketData({
        hostEvents: new BufferedHostEventStream(),
        notifications,
        leases,
        ownedLeases: new Set(),
        invoke: async () => ({ result: null }),
        refusal: () => null,
        reportFailure: () => {},
      }),
  });
  let stopped = false;
  const stop = server.stop;
  cleanups.push(async () => {
    if (!stopped) await stop();
    leases.dispose();
    await Effect.runPromise(notifications.dispose());
  });
  return {
    endpoint: server.endpoint,
    stop: async () => {
      stopped = true;
      await stop();
    },
  };
};

/** The bytes of one received socket message. */
const frameBytes = (data: WebSocket.RawData): Uint8Array =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data;

const authorization = (token: string) => `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`;

/** Sends one WebSocket upgrade and resolves with the HTTP status of a refusal. */
const refusalStatus = (
  url: string,
  headers: Record<string, string>,
  path = "/channel",
): Promise<number> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = httpRequest({
      host: target.hostname,
      port: target.port,
      path,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": Buffer.from("0123456789abcdef").toString("base64"),
        ...headers,
      },
    });
    outgoing.once("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("The server accepted an upgrade that it must refuse."));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });

const validHeaders = (server: ElectronHostChannelServer) => ({
  origin: RENDERER_ORIGIN,
  "sec-websocket-protocol": `${HOST_CHANNEL_SUBPROTOCOL}, ${authorization(server.endpoint.token)}`,
});

test("serves the channel on loopback with a per-launch token", async () => {
  const server = await startServer();
  const other = await startServer();

  expect(server.endpoint.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/channel$/);
  expect(server.endpoint.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(other.endpoint.token).not.toBe(server.endpoint.token);
});

test("refuses a socket without the renderer origin, loopback host, token, or route", async () => {
  const server = await startServer();
  const { url, token } = server.endpoint;
  const port = new URL(url).port;

  expect(
    await refusalStatus(url, { ...validHeaders(server), origin: "https://evil.example" }),
  ).toBe(403);
  expect(await refusalStatus(url, { ...validHeaders(server), host: `localhost:${port}` })).toBe(
    403,
  );
  expect(
    await refusalStatus(url, {
      ...validHeaders(server),
      "sec-websocket-protocol": HOST_CHANNEL_SUBPROTOCOL,
    }),
  ).toBe(401);
  expect(
    await refusalStatus(url, {
      ...validHeaders(server),
      "sec-websocket-protocol": `${HOST_CHANNEL_SUBPROTOCOL}, ${authorization("x".repeat(43))}`,
    }),
  ).toBe(401);
  expect(
    await refusalStatus(url, {
      ...validHeaders(server),
      "sec-websocket-protocol": `openducktor-terminal.v3, ${authorization(token)}`,
    }),
  ).toBe(401);
  expect(await refusalStatus(url, validHeaders(server), "/terminal")).toBe(404);
});

test("answers events.open on an authorized socket and closes it on stop", async () => {
  const server = await startServer();
  const socket = new WebSocket(
    server.endpoint.url,
    [HOST_CHANNEL_SUBPROTOCOL, authorization(server.endpoint.token)],
    { origin: RENDERER_ORIGIN },
  );
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const result = new Promise<unknown>((resolve) =>
    socket.on("message", (data) => {
      const { header, body } = splitHostChannelFrame(frameBytes(data));
      const message = hostChannelMessageSchema.parse(JSON.parse(header));
      if (message.type === "result" && body) resolve(JSON.parse(new TextDecoder().decode(body)));
    }),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  expect(socket.protocol).toBe(HOST_CHANNEL_SUBPROTOCOL);

  socket.send(
    encodeHostChannelFrame({
      type: "request",
      id: 0,
      method: "events.open",
      cursor: null,
      notificationCursor: null,
    }),
  );
  expect(hostEventsOpenedSchema.parse(await result)).toMatchObject({
    hostChanged: false,
    gaps: [],
  });

  await server.stop();
  await closed;
});

test("accepts the file origin of a packaged window and refuses the null fetch origin", async () => {
  const server = await startServer(resolveElectronRendererSocketOrigins(undefined));
  const socket = new WebSocket(
    server.endpoint.url,
    [HOST_CHANNEL_SUBPROTOCOL, authorization(server.endpoint.token)],
    { origin: "file://" },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  expect(socket.protocol).toBe(HOST_CHANNEL_SUBPROTOCOL);
  socket.close();

  expect(
    await refusalStatus(server.endpoint.url, { ...validHeaders(server), origin: "null" }),
  ).toBe(403);
});
