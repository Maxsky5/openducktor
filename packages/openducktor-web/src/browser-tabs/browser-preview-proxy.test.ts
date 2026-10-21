import { afterEach, describe, expect, test } from "bun:test";
import { createServer, request as httpRequest, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { type BrowserPreviewProxies, createBrowserPreviewProxies } from "./browser-preview-proxy";

const APP_ORIGIN = "http://localhost:5555";

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(z.object({ port: z.number() }).parse(server.address()).port);
    });
  });

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A dev server that answers each test path, and a preview of it. */
const startPreview = async () => {
  let finishStream = () => {};
  const target = createServer((request, response) => {
    switch (request.url) {
      case "/":
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
        });
        response.end("<!doctype html><html><head><title>App</title></head><body>Hi</body></html>");
        return;
      case "/stream":
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.write("<!doctype html><html><head><title>App</title></head><body>Loading");
        finishStream = () => response.end(" done</body></html>");
        return;
      case "/next":
        response.writeHead(302, { location: `http://localhost:${targetPort}/done?x=1` });
        response.end();
        return;
      case "/account/settings":
        response.writeHead(302, { location: "login" });
        response.end();
        return;
      case "/account/profile":
        response.writeHead(302, { location: "?tab=2" });
        response.end();
        return;
      case "/away":
        response.writeHead(302, { location: "https://accounts.example.com/login?next=%2F" });
        response.end();
        return;
      case "/cut":
        response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
        response.write('{"partial":');
        setTimeout(() => response.destroy(), 20);
        return;
      case "/echo":
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(request.headers));
        return;
      default:
        response.writeHead(404).end();
    }
  });
  const sockets = new WebSocketServer({ server: target });
  sockets.on("connection", (socket, request) => {
    socket.send(`host ${request.headers.host}`);
    socket.on("message", (data) => socket.send(`echo ${String(data)}`));
  });
  const targetPort = await listen(target);
  const previews = createBrowserPreviewProxies({ reportFailure: () => {} });
  cleanups.push(
    () => new Promise<void>((resolve) => target.close(() => resolve())),
    () => {
      sockets.close();
      target.closeAllConnections();
    },
    () => previews.close(),
  );
  const origin = await previews.originFor({
    target: `http://localhost:${targetPort}/some/page`,
    appOrigin: APP_ORIGIN,
  });
  return { origin, previews, targetPort, finishStream: () => finishStream() };
};

describe("browser preview proxy", () => {
  test("serves a page with the frame script, and lets only the app frame it", async () => {
    const { origin } = await startPreview();

    const response = await fetch(`${origin}/`);
    const html = await response.text();

    expect(origin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(html).toContain(
      '<head><script src="/__openducktor/frame.js"></script><title>App</title>',
    );
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      `default-src 'self'; frame-ancestors ${APP_ORIGIN}`,
    );
    expect(html).toEndWith("<body>Hi</body></html>");
    const script = await (await fetch(`${origin}/__openducktor/frame.js`)).text();
    expect(script).toContain(JSON.stringify([APP_ORIGIN]));
  });

  test("streams a page as the dev server sends it, such as a loading state", async () => {
    const { origin, finishStream } = await startPreview();
    const response = await fetch(`${origin}/stream`);
    if (!response.body) throw new Error("Expected a page body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (!html.includes("Loading")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The page ended before its first content.");
      html += decoder.decode(value, { stream: true });
    }
    finishStream();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      html += decoder.decode(chunk.value, { stream: true });
    }

    expect(html).toBe(
      '<!doctype html><html><head><script src="/__openducktor/frame.js"></script><title>App</title></head><body>Loading done</body></html>',
    );
  });

  test("keeps redirects of the dev server in the preview, and stops redirects to other sites", async () => {
    const { origin } = await startPreview();

    const inside = await fetch(`${origin}/next`, { redirect: "manual" });
    const outside = await fetch(`${origin}/away`, { redirect: "manual" });
    const leave = await fetch(`${origin}${outside.headers.get("location")}`);

    expect(inside.headers.get("location")).toBe("/done?x=1");
    const relative = await fetch(`${origin}/account/settings`, { redirect: "manual" });
    const queryOnly = await fetch(`${origin}/account/profile`, { redirect: "manual" });
    expect(relative.headers.get("location")).toBe("/account/login");
    expect(queryOnly.headers.get("location")).toBe("/account/profile?tab=2");
    expect(outside.headers.get("location")).toBe(
      `/__openducktor/leave?url=${encodeURIComponent("https://accounts.example.com/login?next=%2F")}`,
    );
    const page = await leave.text();
    expect(page).toContain("Opening accounts.example.com...");
    expect(page).toContain('<script src="/__openducktor/frame.js"></script>');
  });

  test("sends requests as if the page came from the dev server, without the web runner session", async () => {
    const { origin, targetPort } = await startPreview();

    const response = await fetch(`${origin}/echo`, {
      headers: {
        origin,
        referer: `${origin}/settings?tab=1`,
        cookie: "openducktor_web_session=secret; theme=dark",
      },
    });
    const headers = z.record(z.string(), z.string()).parse(await response.json());

    expect(headers.host).toBe(`localhost:${targetPort}`);
    expect(headers.origin).toBe(`http://localhost:${targetPort}`);
    expect(headers.referer).toBe(`http://localhost:${targetPort}/settings?tab=1`);
    expect(headers.cookie).toBe("theme=dark");
  });

  test("refuses a request for another host name, which DNS rebinding sends", async () => {
    const { origin } = await startPreview();
    const port = new URL(origin).port;

    const status = await new Promise<number>((resolve, reject) => {
      httpRequest(
        { hostname: "127.0.0.1", port, path: "/", headers: { host: `evil.example:${port}` } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      )
        .on("error", reject)
        .end();
    });

    expect(status).toBe(421);
  });

  test("passes WebSocket connections through, such as the hot reload of a dev server", async () => {
    const { origin, targetPort } = await startPreview();
    const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`);
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on("message", (data) => {
        messages.push(String(data));
        if (messages.length === 1) socket.send("ping");
        if (messages.length === 2) resolve();
      });
      socket.on("error", reject);
    });
    socket.close();

    expect(messages).toEqual([`host localhost:${targetPort}`, "echo ping"]);
  });

  test("closes while a WebSocket connection stays open", async () => {
    const { origin, previews } = await startPreview();
    const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once("message", () => resolve());
      socket.on("error", reject);
    });
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

    await previews.close();
    await closed;
  });

  test("ends a response at once when the dev server drops it", async () => {
    const { origin } = await startPreview();
    const response = await fetch(`${origin}/cut`);

    await expect(response.text()).rejects.toThrow();
  });

  test("shows the error of a dev server that does not answer in the tab", async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const previews: BrowserPreviewProxies = createBrowserPreviewProxies({
      reportFailure: () => {},
    });
    cleanups.push(() => previews.close());
    const origin = await previews.originFor({
      target: `http://localhost:${port}/`,
      appOrigin: APP_ORIGIN,
    });

    const response = await fetch(`${origin}/app`);

    expect(response.status).toBe(502);
    const html = await response.text();
    expect(html).toContain("window.__openducktorFrameError=");
    expect(html).toContain(
      `http://localhost:${port}/app did not answer: nothing listens on its port.`,
    );
  });

  test("previews only pages of this machine", async () => {
    const previews = createBrowserPreviewProxies({ reportFailure: () => {} });
    cleanups.push(() => previews.close());

    await expect(
      previews.originFor({ target: "https://example.com/", appOrigin: APP_ORIGIN }),
    ).rejects.toThrow("OpenDucktor previews only pages of this machine");
  });
});
