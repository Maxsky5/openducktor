import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { browserTabIdSchema } from "@openducktor/contracts";
import type {
  BrowserDevToolsConnection,
  BrowserDevToolsPeer,
  BrowserServiceError,
} from "@openducktor/host";
import { Effect, Exit } from "effect";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { ElectronOperationError, errorMessage } from "../../effect/electron-errors";
import { DEVTOOLS_FRONTEND_ORIGIN } from "./electron-browser-policy";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
/** A DevTools frontend that falls this far behind loses its connection. */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const tcpAddressSchema = z.object({ port: z.number().int().positive() });

export type DevToolsConnector = {
  connectDevTools(
    tabId: string,
    peer: BrowserDevToolsPeer,
  ): Effect.Effect<BrowserDevToolsConnection, BrowserServiceError>;
};

export type DevToolsEndpointInput = {
  /** True while the tab has a page that DevTools can inspect. */
  hasLiveTab(tabId: string): boolean;
  reportFailure(operation: string, cause: unknown): void;
};

export type DevToolsUpgradeRequest = {
  readonly url: string | undefined;
  readonly origin: string | undefined;
};

/** The tab of a valid DevTools upgrade request, or `null` when the request must be refused. */
export const readDevToolsUpgradeTab = (
  request: DevToolsUpgradeRequest,
  secret: string,
): string | null => {
  if (request.origin !== DEVTOOLS_FRONTEND_ORIGIN || request.url === undefined) {
    return null;
  }
  const match = /^\/([^/]+)\/devtools\/([^/?#]+)$/.exec(request.url);
  if (match === null) {
    return null;
  }
  const [, requestSecret = "", tabId = ""] = match;
  const expected = Buffer.from(secret);
  const received = Buffer.from(requestSecret);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }
  return browserTabIdSchema.safeParse(tabId).success ? tabId : null;
};

export const devToolsFrontendUrl = (port: number, secret: string, tabId: string): string =>
  `devtools://devtools/bundled/devtools_app.html?ws=${LOOPBACK_HOST}:${port}/${secret}/devtools/${tabId}`;

const refuseUpgrade = (socket: Duplex, status: string): void => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

/**
 * The loopback WebSocket endpoint of the docked Electron DevTools. It accepts only the bundled
 * DevTools frontend with the secret of this app start, and connects each socket to one tab
 * through the host browser service.
 */
export const createElectronDevToolsEndpoint = (input: DevToolsEndpointInput) => {
  const secret = randomBytes(32).toString("base64url");
  const sockets = new Set<WebSocket>();
  let server: Server | null = null;
  let port: number | null = null;

  const connectSocket = (connector: DevToolsConnector, socket: WebSocket, tabId: string) => {
    sockets.add(socket);
    let connection: BrowserDevToolsConnection | null = null;
    let closed = false;
    let queue = Promise.resolve();
    const pending: string[] = [];

    const closeSocket = (code: number, reason: string): void => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code, reason);
      }
    };

    const handle = (active: BrowserDevToolsConnection, text: string): void => {
      queue = queue
        .then(() => Effect.runPromiseExit(active.handle(text)))
        .then((exit) => {
          if (Exit.isFailure(exit)) {
            closeSocket(1008, "DevTools sent a message that is not a CDP command.");
          }
        });
    };

    socket.on("message", (data: RawData, isBinary: boolean) => {
      // The server keeps the default `nodebuffer` binary type, so text arrives as a Buffer.
      if (isBinary || !Buffer.isBuffer(data)) {
        closeSocket(1003, "DevTools messages must be text.");
        return;
      }
      const text = data.toString("utf8");
      if (connection === null) {
        pending.push(text);
      } else {
        handle(connection, text);
      }
    });
    socket.on("close", () => {
      closed = true;
      sockets.delete(socket);
      if (connection !== null) {
        void Effect.runPromise(connection.close());
      }
    });
    socket.on("error", (cause) => input.reportFailure("electron.browser.devtools.socket", cause));

    const peer: BrowserDevToolsPeer = {
      send: (message) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          closeSocket(1013, "DevTools fell behind the page.");
          return;
        }
        socket.send(message);
      },
      close: () => closeSocket(1001, "The browser tab closed."),
    };

    void Effect.runPromiseExit(connector.connectDevTools(tabId, peer)).then((exit) => {
      if (Exit.isFailure(exit)) {
        closeSocket(1011, "DevTools could not connect to the browser tab.");
        input.reportFailure("electron.browser.devtools.connect", exit.cause);
        return;
      }
      if (closed) {
        void Effect.runPromise(exit.value.close());
        return;
      }
      connection = exit.value;
      for (const text of pending.splice(0)) {
        handle(exit.value, text);
      }
    });
  };

  return {
    /** Starts listening on an ephemeral loopback port. */
    start: (connector: DevToolsConnector): Effect.Effect<void, ElectronOperationError> =>
      Effect.callback<void, ElectronOperationError>((resume) => {
        const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
        const httpServer = createServer((_request, response) => {
          response.writeHead(404).end();
        });
        httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          const tabId = readDevToolsUpgradeTab(
            { url: request.url, origin: request.headers.origin },
            secret,
          );
          if (tabId === null) {
            refuseUpgrade(socket, "403 Forbidden");
            return;
          }
          if (!input.hasLiveTab(tabId)) {
            refuseUpgrade(socket, "404 Not Found");
            return;
          }
          webSockets.handleUpgrade(request, socket, head, (webSocket) =>
            connectSocket(connector, webSocket, tabId),
          );
        });
        httpServer.once("error", (cause) =>
          resume(
            Effect.fail(
              new ElectronOperationError({
                operation: "electron.browser.devtools.listen",
                message: `The DevTools endpoint could not start: ${errorMessage(cause)}`,
                cause,
              }),
            ),
          ),
        );
        httpServer.listen(0, LOOPBACK_HOST, () => {
          const address = tcpAddressSchema.safeParse(httpServer.address());
          if (!address.success) {
            resume(
              Effect.fail(
                new ElectronOperationError({
                  operation: "electron.browser.devtools.listen",
                  message: "The DevTools endpoint has no TCP port.",
                }),
              ),
            );
            return;
          }
          server = httpServer;
          port = address.data.port;
          resume(Effect.void);
        });
      }),
    /** The frontend URL of a tab, or `null` while the endpoint is not running. */
    frontendUrl: (tabId: string): string | null =>
      port === null ? null : devToolsFrontendUrl(port, secret, tabId),
    stop: (): Effect.Effect<void> =>
      Effect.callback<void>((resume) => {
        const running = server;
        server = null;
        port = null;
        for (const socket of sockets) {
          socket.terminate();
        }
        sockets.clear();
        if (running === null) {
          resume(Effect.void);
          return;
        }
        running.close(() => resume(Effect.void));
      }),
  };
};

export type ElectronDevToolsEndpoint = ReturnType<typeof createElectronDevToolsEndpoint>;
