import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import { startNodeFetchServer } from "@openducktor/remote-host/node-fetch-server";

// The server checks its peers each 15 seconds. This check runs those checks at once.
const PEER_CHECK_INTERVAL_MS = 15_000;
const peerChecks: Array<() => void> = [];
const nativeSetInterval = globalThis.setInterval;
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
const live = new WebSocket(`ws://127.0.0.1:${server.port}`);
const gone = new WebSocket(`ws://127.0.0.1:${server.port}`, { autoPong: false });
try {
  await Promise.all([once(live, "open"), once(gone, "open")]);
  const goneClosed = once(gone, "close");
  for (let check = 0; check < 4; check += 1) {
    for (const runCheck of peerChecks) runCheck();
    // The live client answers the ping before the next check.
    await sleep(50);
  }
  await goneClosed;
  assert.equal(live.readyState, WebSocket.OPEN);
} finally {
  globalThis.setInterval = nativeSetInterval;
  live.terminate();
  gone.terminate();
  await server.stop(true);
}
