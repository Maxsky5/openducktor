import { afterEach, describe, expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import type { BrowserDevToolsPeer } from "@openducktor/host";
import { BrowserServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { WebSocket } from "ws";
import {
  createElectronDevToolsEndpoint,
  type ElectronDevToolsEndpoint,
  readDevToolsUpgradeTab,
} from "./electron-browser-devtools-endpoint";
import { DEVTOOLS_FRONTEND_ORIGIN } from "./electron-browser-policy";

const TAB_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(43);

describe("readDevToolsUpgradeTab", () => {
  const read = (url: string | undefined, origin?: string) =>
    readDevToolsUpgradeTab({ url, origin }, SECRET);

  test("accepts the DevTools frontend with the secret and a tab ID", () => {
    expect(read(`/${SECRET}/devtools/${TAB_ID}`, DEVTOOLS_FRONTEND_ORIGIN)).toBe(TAB_ID);
  });

  test("refuses another origin, secret, path, or tab ID", () => {
    expect(read(`/${SECRET}/devtools/${TAB_ID}`, "http://localhost:3000")).toBeNull();
    expect(read(`/${SECRET}/devtools/${TAB_ID}`, undefined)).toBeNull();
    expect(read(`/${"t".repeat(43)}/devtools/${TAB_ID}`, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
    expect(read(`/short/devtools/${TAB_ID}`, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
    expect(read(`/${SECRET}/devtools/not-a-tab`, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
    expect(read(`/${SECRET}/devtools/${TAB_ID}/extra`, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
    expect(read(`/${SECRET}/other/${TAB_ID}`, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
    expect(read(undefined, DEVTOOLS_FRONTEND_ORIGIN)).toBeNull();
  });
});

/** The secret and port of a frontend URL. */
const endpointPath = (frontendUrl: string) => {
  const ws = new URL(frontendUrl).searchParams.get("ws") ?? "";
  const [host = "", ...path] = ws.split("/");
  return { host, path: `/${path.join("/")}` };
};

const upgradeStatus = (host: string, path: string, origin: string) =>
  new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      host: host.split(":")[0],
      port: Number(host.split(":")[1]),
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });
    request.on("response", (response) => resolve(response.statusCode ?? 0));
    request.on("upgrade", () => resolve(101));
    request.on("error", reject);
    request.end();
  });

describe("createElectronDevToolsEndpoint", () => {
  let endpoint: ElectronDevToolsEndpoint | null = null;

  afterEach(async () => {
    if (endpoint !== null) await Effect.runPromise(endpoint.stop());
    endpoint = null;
  });

  const start = async (live: boolean) => {
    const handled: string[] = [];
    const closed: string[] = [];
    const peers: BrowserDevToolsPeer[] = [];
    endpoint = createElectronDevToolsEndpoint({
      hasLiveTab: (tabId) => live && tabId === TAB_ID,
      reportFailure: () => {},
    });
    await Effect.runPromise(
      endpoint.start({
        connectDevTools: (tabId, peer) =>
          Effect.sync(() => {
            peers.push(peer);
            return {
              handle: (message: string) =>
                message === "bad"
                  ? Effect.fail(
                      new BrowserServiceError({
                        code: "protocol_error",
                        operation: "test",
                        message: "bad",
                        tabId,
                      }),
                    )
                  : Effect.sync(() => {
                      handled.push(message);
                    }),
              close: () => Effect.sync(() => closed.push(tabId)),
            };
          }),
      }),
    );
    const url = endpoint.frontendUrl(TAB_ID);
    if (url === null) throw new Error("Expected a frontend URL.");
    return { url, handled, closed, peers };
  };

  test("builds the bundled frontend URL with a loopback ws address", async () => {
    const { url } = await start(true);
    expect(url).toMatch(
      new RegExp(
        `^devtools://devtools/bundled/devtools_app\\.html\\?ws=127\\.0\\.0\\.1:\\d+/[A-Za-z0-9_-]{43}/devtools/${TAB_ID}$`,
      ),
    );
  });

  test("connects the DevTools frontend to its tab in both directions", async () => {
    const { url, handled, closed, peers } = await start(true);
    const { host, path } = endpointPath(url);
    const socket = new WebSocket(`ws://${host}${path}`, {
      headers: { Origin: DEVTOOLS_FRONTEND_ORIGIN },
    });
    const received = new Promise<string>((resolve) =>
      socket.on("message", (data) => resolve(String(data))),
    );
    await new Promise<void>((resolve) => socket.on("open", () => resolve()));
    socket.send('{"id":1,"method":"Runtime.enable"}');
    await new Promise((resolve) => setTimeout(resolve, 20));
    peers[0]?.send('{"id":1,"result":{}}');
    expect(await received).toBe('{"id":1,"result":{}}');
    expect(handled).toEqual(['{"id":1,"method":"Runtime.enable"}']);

    const socketClosed = new Promise<number>((resolve) =>
      socket.on("close", (code) => resolve(code)),
    );
    peers[0]?.close();
    expect(await socketClosed).toBe(1001);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toEqual([TAB_ID]);
  });

  test("closes the socket when DevTools sends a message that is not a command", async () => {
    const { url } = await start(true);
    const { host, path } = endpointPath(url);
    const socket = new WebSocket(`ws://${host}${path}`, {
      headers: { Origin: DEVTOOLS_FRONTEND_ORIGIN },
    });
    await new Promise<void>((resolve) => socket.on("open", () => resolve()));
    const socketClosed = new Promise<number>((resolve) =>
      socket.on("close", (code) => resolve(code)),
    );
    socket.send("bad");
    expect(await socketClosed).toBe(1008);
  });

  test("answers 403 to a wrong origin and 404 to a tab without a page", async () => {
    const { url } = await start(true);
    const { host, path } = endpointPath(url);
    expect(await upgradeStatus(host, path, "http://localhost:3000")).toBe(403);
    expect(
      await upgradeStatus(
        host,
        path.replace(TAB_ID, "22222222-2222-4222-8222-222222222222"),
        DEVTOOLS_FRONTEND_ORIGIN,
      ),
    ).toBe(404);
    expect(await upgradeStatus(host, path, DEVTOOLS_FRONTEND_ORIGIN)).toBe(101);
  });
});
