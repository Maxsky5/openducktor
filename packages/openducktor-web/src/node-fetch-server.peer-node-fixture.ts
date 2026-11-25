import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { startNodeFetchServer } from "@openducktor/remote-host/node-fetch-server";

// The server checks its peers each 15 seconds. This check runs those checks at once.
const PEER_CHECK_INTERVAL_MS = 15_000;
const peerChecks: Array<() => void> = [];
const nativeSetInterval = globalThis.setInterval;
const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
let livePeer: WebSocket | undefined;
WebSocketServer.prototype.handleUpgrade = function (request, socket, head, upgraded) {
  return handleUpgrade.call(this, request, socket, head, (peer, accepted) => {
    if (accepted.url === "/live") livePeer = peer;
    upgraded(peer, accepted);
  });
};
// SAFETY: the replacement takes the arguments of the native setInterval and returns its timer.
globalThis.setInterval = ((callback: () => void, delay?: number) => {
  if (delay === PEER_CHECK_INTERVAL_MS) peerChecks.push(callback);
  return nativeSetInterval(callback, delay);
}) as typeof setInterval;

const server = await startNodeFetchServer({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (_request, currentServer) =>
    currentServer.upgrade({ data: null }) ? undefined : new Response("Not found", { status: 404 }),
  websocket: {
    perMessageDeflate: false,
    maxPayloadLength: 1024,
    message: () => {},
    drain: () => {},
    close: () => {},
  },
  onError: (cause) => {
    throw cause;
  },
});
// The first client answers pings, as browsers and React Native do. The second one is gone.
const live = new WebSocket(`ws://127.0.0.1:${server.port}/live`);
const gone = new WebSocket(`ws://127.0.0.1:${server.port}/gone`, { autoPong: false });
try {
  await Promise.all([once(live, "open"), once(gone, "open")]);
  assert.ok(livePeer, "The server must accept the live peer.");
  const goneClosed = once(gone, "close");
  for (let check = 0; check < 3; check += 1) {
    const pong = once(livePeer, "pong");
    for (const runCheck of peerChecks) runCheck();
    await pong;
  }
  await goneClosed;
  assert.equal(live.readyState, WebSocket.OPEN);
} finally {
  globalThis.setInterval = nativeSetInterval;
  WebSocketServer.prototype.handleUpgrade = handleUpgrade;
  live.terminate();
  gone.terminate();
  await server.stop(true);
}
