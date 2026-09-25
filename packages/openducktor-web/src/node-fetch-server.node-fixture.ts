import assert from "node:assert/strict";
import { once } from "node:events";
import { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket } from "ws";
import { startNodeFetchServer } from "./node-fetch-server";

type CorkState = { socket?: Duplex; corked: boolean };

const smallFrame = new Uint8Array([1]);
const largeFrame = new Uint8Array(8 * 1024 * 1024);
let signalSmallSend = () => {};
let signalLargeSend = () => {};
const smallSendCompleted = new Promise<void>((resolve) => {
  signalSmallSend = resolve;
});
const largeSendCompleted = new Promise<void>((resolve) => {
  signalLargeSend = resolve;
});
let queuedAtSmallCallback = 0;
const corkState: CorkState = { corked: false };
const originalSend = WebSocket.prototype.send;
const originalEmit = Server.prototype.emit;
const listeningServers: Server[] = [];
Server.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
  if (event === "listening") listeningServers.push(this);
  return originalEmit.call(this, event, ...args);
};
// SAFETY: Every send in this isolated check passes an options object.
WebSocket.prototype.send = function (
  this: WebSocket,
  frame: Parameters<WebSocket["send"]>[0],
  options: Parameters<WebSocket["send"]>[1],
  callback?: Parameters<WebSocket["send"]>[2],
) {
  if (frame === largeFrame) {
    // SAFETY: Node ws assigns _socket before it accepts a send.
    corkState.socket = (this as WebSocket & { _socket: Duplex })._socket;
    corkState.socket.cork();
    corkState.corked = true;
  }
  originalSend.call(this, frame, options, (cause) => {
    if (frame === smallFrame) queuedAtSmallCallback = this.bufferedAmount;
    callback?.(cause);
    if (frame === smallFrame) signalSmallSend();
    if (frame === largeFrame) signalLargeSend();
  });
} as WebSocket["send"];

const errors: unknown[] = [];
let drainCount = 0;
const server = await startNodeFetchServer({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, currentServer) =>
    currentServer.upgrade(request, { data: null })
      ? undefined
      : new Response("Not found", { status: 404 }),
  websocket: {
    perMessageDeflate: false,
    maxPayloadLength: 1024,
    message: (socket) => {
      socket.send(smallFrame, false);
      socket.send(largeFrame, false);
    },
    drain: () => {
      drainCount += 1;
    },
    close: () => {},
  },
  onError: (cause) => {
    errors.push(cause);
  },
});
const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
try {
  await once(client, "open");
  client.send("go", { binary: false });
  await smallSendCompleted;
  assert.ok(queuedAtSmallCallback > 0, "the large frame must still be queued");
  assert.equal(drainCount, 0);

  assert.ok(corkState.socket);
  corkState.socket.uncork();
  corkState.corked = false;
  await largeSendCompleted;
  assert.equal(drainCount, 1);
  assert.deepEqual(errors, []);

  const nativeServer = listeningServers[0];
  assert.ok(nativeServer);
  const serverError = new Error("server error after listen");
  nativeServer.emit("error", serverError);
  assert.deepEqual(errors, [serverError]);
} finally {
  if (corkState.corked) corkState.socket?.uncork();
  client.terminate();
  await server.stop(true);
  WebSocket.prototype.send = originalSend;
  Server.prototype.emit = originalEmit;
}
