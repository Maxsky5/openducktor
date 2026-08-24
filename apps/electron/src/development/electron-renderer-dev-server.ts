import path from "node:path";
import { Effect } from "effect";
import { createServer, type ViteDevServer } from "vite";
import {
  ElectronOperationError,
  errorMessage,
  toElectronOperationError,
} from "../effect/electron-errors";

const RENDERER_DEV_HOST = "127.0.0.1";

type ForceCloseableHttpServer = {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};

export type ElectronDevRendererWatcher = {
  add(paths: string | readonly string[]): ElectronDevRendererWatcher;
  on(
    event: "add" | "change" | "unlink",
    listener: (filePath: string) => void,
  ): ElectronDevRendererWatcher;
};

export type ElectronDevRendererServer = {
  close(): Promise<void>;
  httpServer?: ViteDevServer["httpServer"];
  resolvedUrls?: { local: string[] } | null;
  watcher: ElectronDevRendererWatcher;
};

type ElectronDevRendererServerHandle = Pick<ElectronDevRendererServer, "close" | "httpServer">;

export type ElectronRendererDevServer = {
  close(): Effect.Effect<void, ElectronOperationError>;
  readonly url: string;
  readonly watcher: ElectronDevRendererWatcher;
};

const callRendererConnectionCloseMethod = (
  httpServer: ViteDevServer["httpServer"] | undefined,
  method: keyof ForceCloseableHttpServer,
): void => {
  if (!httpServer || !(method in httpServer)) {
    return;
  }

  if (
    method === "closeIdleConnections" &&
    "closeIdleConnections" in httpServer &&
    typeof httpServer.closeIdleConnections === "function"
  ) {
    httpServer.closeIdleConnections();
  }
  if (
    method === "closeAllConnections" &&
    "closeAllConnections" in httpServer &&
    typeof httpServer.closeAllConnections === "function"
  ) {
    httpServer.closeAllConnections();
  }
};

const forceCloseRendererConnections = (server: ElectronDevRendererServerHandle): void => {
  callRendererConnectionCloseMethod(server.httpServer, "closeIdleConnections");
  callRendererConnectionCloseMethod(server.httpServer, "closeAllConnections");
};

export const closeRendererServerEffect = (
  server: ElectronDevRendererServerHandle | null,
): Effect.Effect<void, ElectronOperationError> => {
  if (!server) {
    return Effect.void;
  }

  return Effect.tryPromise({
    try: async () => {
      let closePromise: Promise<void>;
      try {
        closePromise = server.close();
      } finally {
        forceCloseRendererConnections(server);
      }
      await closePromise;
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.close-renderer-server",
        message: errorMessage(cause),
        cause,
      }),
  });
};

export const resolveRendererDevUrl = (server: ElectronDevRendererServer): string => {
  const localUrl = server.resolvedUrls?.local.find((url) => url.includes(RENDERER_DEV_HOST));
  if (localUrl) {
    return localUrl.replace(/\/$/u, "");
  }

  throw new ElectronOperationError({
    operation: "electron.dev.resolve-renderer-url",
    message: `Vite renderer dev server did not report a local URL for ${RENDERER_DEV_HOST}.`,
  });
};

export const createElectronRendererDevServerEffect = ({
  packageRoot,
  port,
}: {
  packageRoot: string;
  port: number;
}): Effect.Effect<ElectronRendererDevServer, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const server = await createServer({
        root: packageRoot,
        configFile: path.join(packageRoot, "vite.config.ts"),
        server: {
          host: RENDERER_DEV_HOST,
          port,
          strictPort: true,
        },
      });
      await server.listen(port);
      server.printUrls();
      const url = resolveRendererDevUrl(server);
      return {
        close: () => closeRendererServerEffect(server),
        url,
        watcher: server.watcher,
      };
    },
    catch: (cause) =>
      toElectronOperationError(cause, "electron.dev.create-renderer-server", { port }),
  });
