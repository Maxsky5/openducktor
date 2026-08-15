import path from "node:path";
import { Effect } from "effect";
import { createServer, type Plugin } from "vite";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  errorMessage,
  toElectronOperationError,
} from "../src/effect/electron-errors";

const RENDERER_DEV_HOST = "127.0.0.1";
const RENDERER_CLOSE_TIMEOUT_MS = 3_000;
const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

type ForceCloseableHttpServer = {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};

export type ElectronDevRendererWatcher = {
  add(paths: string | readonly string[]): unknown;
  on(event: "add" | "change" | "unlink", listener: (filePath: string) => void): unknown;
};

export type ElectronDevRendererServer = {
  close(): Promise<void>;
  config: { server: { port?: number | null } };
  httpServer?: object | null;
  resolvedUrls?: { local: string[] } | null;
  watcher: ElectronDevRendererWatcher;
};

type ElectronDevRendererServerHandle = Pick<ElectronDevRendererServer, "close" | "httpServer">;

export type ElectronRendererDevServer = {
  close(): Effect.Effect<void, ElectronOperationError>;
  dispose(): void;
  isViteShutdownRequested(): boolean;
  registerViteShutdown(stopElectron: () => Promise<void>): void;
  readonly url: string;
  readonly watcher: ElectronDevRendererWatcher;
};

type ElectronViteShutdownBridge = {
  completeLifecycleStartup(stopElectron: (() => Promise<void>) | null): void;
  dispose(): void;
  isShutdownRequested(): boolean;
  requestShutdown(): void;
  stopElectronOnShutdown(): Promise<void>;
  vitePlugin: Plugin;
};

export const createElectronViteShutdownBridge = (): ElectronViteShutdownBridge => {
  let settleLifecycleStartup: ((stopElectron: (() => Promise<void>) | null) => void) | null = null;
  const lifecycleStartup = new Promise<(() => Promise<void>) | null>((resolve) => {
    settleLifecycleStartup = resolve;
  });
  let shutdownRequested = false;
  const markShutdown = (): void => {
    shutdownRequested = true;
  };
  process.once("SIGTERM", markShutdown);

  const completeLifecycleStartup = (stopElectron: (() => Promise<void>) | null): void => {
    settleLifecycleStartup?.(stopElectron);
    settleLifecycleStartup = null;
  };
  const stopElectronOnShutdown = async (): Promise<void> => {
    if (!shutdownRequested) {
      return;
    }
    const stopElectron = await lifecycleStartup;
    await stopElectron?.();
  };

  return {
    completeLifecycleStartup,
    dispose() {
      process.off("SIGTERM", markShutdown);
      completeLifecycleStartup(null);
    },
    isShutdownRequested() {
      return shutdownRequested;
    },
    requestShutdown: markShutdown,
    stopElectronOnShutdown,
    vitePlugin: {
      name: "openducktor-electron-shutdown",
      closeBundle: stopElectronOnShutdown,
    },
  };
};

const callRendererConnectionCloseMethod = (
  httpServer: object | null | undefined,
  method: keyof ForceCloseableHttpServer,
): void => {
  if (!httpServer || !(method in httpServer)) {
    return;
  }

  const close = Reflect.get(httpServer, method);
  if (typeof close === "function") {
    close.call(httpServer);
  }
};

const forceCloseRendererConnections = (server: ElectronDevRendererServerHandle): void => {
  callRendererConnectionCloseMethod(server.httpServer, "closeIdleConnections");
  callRendererConnectionCloseMethod(server.httpServer, "closeAllConnections");
};

export const closeRendererServerEffect = (
  server: ElectronDevRendererServerHandle | null,
  closeSleep: (durationMs: number) => Promise<unknown> = sleep,
): Effect.Effect<void, ElectronOperationError> => {
  if (!server) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const closePromise = yield* Effect.try({
      try: () => {
        try {
          return server.close();
        } finally {
          forceCloseRendererConnections(server);
        }
      },
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.dev.close-renderer-server",
          message: errorMessage(cause),
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: async () => {
        await Promise.race([closePromise, closeSleep(RENDERER_CLOSE_TIMEOUT_MS)]);
      },
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.dev.close-renderer-server",
          message: errorMessage(cause),
          cause,
        }),
    });
  });
};

export const closeRendererServer = async (
  server: ElectronDevRendererServerHandle | null,
  closeSleep: (durationMs: number) => Promise<unknown> = sleep,
): Promise<void> => {
  await runElectronEffect(closeRendererServerEffect(server, closeSleep));
};

export const resolveRendererDevUrl = (server: ElectronDevRendererServer): string => {
  const localUrl = server.resolvedUrls?.local.find((url) => url.includes(RENDERER_DEV_HOST));
  if (localUrl) {
    return localUrl.replace(/\/$/u, "");
  }

  const configuredPort = server.config.server.port;
  if (!configuredPort) {
    throw new ElectronOperationError({
      operation: "electron.dev.resolve-renderer-url",
      message: "Vite renderer dev server did not expose a configured port.",
    });
  }

  return `http://${RENDERER_DEV_HOST}:${configuredPort}`;
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
      const shutdownBridge = createElectronViteShutdownBridge();
      try {
        const server = await createServer({
          root: packageRoot,
          configFile: path.join(packageRoot, "vite.config.ts"),
          plugins: [shutdownBridge.vitePlugin],
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
          dispose: shutdownBridge.dispose,
          isViteShutdownRequested: shutdownBridge.isShutdownRequested,
          registerViteShutdown: shutdownBridge.completeLifecycleStartup,
          url,
          watcher: server.watcher,
        };
      } catch (cause) {
        shutdownBridge.dispose();
        throw cause;
      }
    },
    catch: (cause) =>
      toElectronOperationError(cause, "electron.dev.create-renderer-server", { port }),
  });
