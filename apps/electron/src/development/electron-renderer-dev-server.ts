import { createServer as createHttpServer, type Server } from "node:http";
import path from "node:path";
import { Effect } from "effect";
import { createServer } from "vite";
import { z } from "zod";
import {
  ElectronOperationError,
  type ElectronOperationErrorAggregate,
  errorMessage,
  toElectronOperationError,
} from "../effect/electron-errors";

const RENDERER_DEV_HOST = "127.0.0.1";

export type ElectronDevRendererWatcher = {
  add(paths: string | readonly string[]): ElectronDevRendererWatcher;
  on(
    event: "add" | "change" | "unlink",
    listener: (filePath: string) => void,
  ): ElectronDevRendererWatcher;
};

type ElectronDevRendererServerHandle = {
  /** Closes Vite. */
  close(): Promise<void>;
  /** The HTTP server that serves the Vite middlewares. The dev script owns it, not Vite. */
  httpServer: Pick<Server, "closeAllConnections" | "close">;
};

export type ElectronRendererDevServer = {
  close(): Effect.Effect<void, ElectronOperationError>;
  readonly url: string;
  readonly watcher: ElectronDevRendererWatcher;
};

export const closeRendererServerEffect = (
  server: ElectronDevRendererServerHandle,
): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      // Stop listening first, then end open connections, so the close does not wait for a
      // keep-alive socket. Bun also stops listening in closeAllConnections, so this order works in
      // Node and Bun.
      const httpServerClosed = new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      server.httpServer.closeAllConnections();
      await Promise.all([server.close(), httpServerClosed]);
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.close-renderer-server",
        message: errorMessage(cause),
        cause,
      }),
  });

const listenRendererServer = (httpServer: Server, port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, RENDERER_DEV_HOST, () => {
      httpServer.off("error", reject);
      const address = z.object({ port: z.number() }).safeParse(httpServer.address());
      if (!address.success) {
        reject(new Error(`The renderer dev server has no TCP port on ${RENDERER_DEV_HOST}.`));
        return;
      }
      resolve(`http://${RENDERER_DEV_HOST}:${address.data.port}`);
    });
  });

export const createElectronRendererDevServerEffect = ({
  packageRoot,
  port,
}: {
  packageRoot: string;
  port: number;
}): Effect.Effect<ElectronRendererDevServer, ElectronOperationErrorAggregate> =>
  Effect.tryPromise({
    try: async () => {
      // The dev script owns the HTTP server and runs Vite in middleware mode. A Vite server with
      // its own HTTP server installs SIGTERM and stdin handlers that exit the process before
      // Electron stops the host runtimes.
      const httpServer = createHttpServer();
      const server = await createServer({
        root: packageRoot,
        configFile: path.join(packageRoot, "vite.config.ts"),
        server: { middlewareMode: true, ws: { server: httpServer } },
      });
      httpServer.on("request", server.middlewares);
      let url: string;
      try {
        url = await listenRendererServer(httpServer, port);
      } catch (cause) {
        await server.close();
        throw cause;
      }
      const handle = { close: () => server.close(), httpServer };
      return {
        close: () => closeRendererServerEffect(handle),
        url,
        watcher: server.watcher,
      };
    },
    catch: (cause) =>
      toElectronOperationError(cause, "electron.dev.create-renderer-server", { port }),
  });
