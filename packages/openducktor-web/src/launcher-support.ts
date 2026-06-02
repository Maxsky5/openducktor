import path from "node:path";
import { logError } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

type ManagedHost = Pick<Bun.Subprocess, "exited"> | TypescriptHostBackend;
type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepFunction = (durationMs: number) => Promise<unknown>;
type BackendReadinessDependencies = {
  fetch: FetchFunction;
  sleep: SleepFunction;
};
export type FrontendServer = {
  close(): Promise<void>;
};
type ForceCloseableHttpServer = {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};
type FrontendServerWithHttpConnections = FrontendServer & {
  httpServer?: ForceCloseableHttpServer | null;
};
type StopLauncherServicesInput = {
  frontendServer: FrontendServer | null;
  hostBackend: TypescriptHostBackend;
};
type LauncherShutdownDependencies = {
  closeServer: (server: FrontendServer | null) => Promise<void>;
  stopHost: (hostBackend: TypescriptHostBackend) => Promise<void>;
};
type KeepAliveTimer = ReturnType<typeof setInterval>;
type ProcessKeepAliveDependencies = {
  clearInterval: (timer: KeepAliveTimer) => void;
  setInterval: (callback: () => void, durationMs: number) => KeepAliveTimer;
};

export const LOCALHOST = "127.0.0.1";

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const FRONTEND_CLOSE_TIMEOUT_MS = 3_000;
const SHUTDOWN_KEEP_ALIVE_INTERVAL_MS = 1_000;

export const buildFrontendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

export const buildBackendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

export const buildFrontendDisplayUrls = (port: number): string[] => [
  `http://localhost:${port}/`,
  `http://${LOCALHOST}:${port}/`,
];

const verifyBackendReadiness = async (
  backendUrl: string,
  appToken: string,
  fetchImpl: FetchFunction,
): Promise<void> => {
  const healthResponse = await fetchImpl(`${backendUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Health endpoint returned ${healthResponse.status}.`);
  }

  const sessionResponse = await fetchImpl(`${backendUrl}/session`, {
    method: "POST",
    headers: {
      [APP_TOKEN_HEADER]: appToken,
    },
  });
  if (!sessionResponse.ok) {
    throw new Error(
      `Session endpoint rejected the launcher app token with status ${sessionResponse.status}.`,
    );
  }
};

const forceCloseFrontendConnections = (server: FrontendServer): void => {
  const httpServer = (server as FrontendServerWithHttpConnections).httpServer;
  httpServer?.closeIdleConnections?.();
  httpServer?.closeAllConnections?.();
};

export const closeFrontendServer = async (
  server: FrontendServer | null,
  sleep: SleepFunction = Bun.sleep,
): Promise<void> => {
  if (!server) {
    return;
  }

  let closePromise: Promise<void>;
  try {
    closePromise = server.close();
  } finally {
    forceCloseFrontendConnections(server);
  }
  await Promise.race([closePromise, sleep(FRONTEND_CLOSE_TIMEOUT_MS)]);
};

export const waitForBackend = async (
  backendUrl: string,
  appToken: string,
  timeoutMs: number,
  hostProcess: ManagedHost,
  dependencies: BackendReadinessDependencies = { fetch, sleep: Bun.sleep },
): Promise<void> => {
  const startedAt = Date.now();
  let lastError: unknown;
  let earlyExitCode: number | null = null;

  void hostProcess.exited.then((exitCode) => {
    earlyExitCode = exitCode;
  });

  while (Date.now() - startedAt < timeoutMs) {
    if (earlyExitCode !== null) {
      throw new Error(
        `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
      );
    }

    try {
      await verifyBackendReadiness(backendUrl, appToken, dependencies.fetch);
      return;
    } catch (error) {
      lastError = error;
    }

    await dependencies.sleep(250);
  }

  if (earlyExitCode !== null) {
    throw new Error(
      `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
    );
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for OpenDucktor web host at ${backendUrl}.${detail}`);
};

export const buildBrowserRuntimeConfigJson = (backendUrl: string, appToken: string): string =>
  `${JSON.stringify({ backendUrl, appToken })}\n`;

export const resolveStaticAssetPath = (staticRoot: string, requestPath: string): string | null => {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  return path.join(staticRoot, normalized);
};

const throwLauncherShutdownFailures = (failures: unknown[]): void => {
  if (failures.length === 0) {
    return;
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  throw new AggregateError(failures, "OpenDucktor web shutdown failed.");
};

const defaultLauncherShutdownDependencies: LauncherShutdownDependencies = {
  closeServer: closeFrontendServer,
  stopHost: (hostBackend) => hostBackend.stop(),
};

export const stopLauncherServices = async (
  { frontendServer, hostBackend }: StopLauncherServicesInput,
  { closeServer, stopHost }: LauncherShutdownDependencies = defaultLauncherShutdownDependencies,
): Promise<void> => {
  const [frontendCloseResult, hostStopResult] = await Promise.allSettled([
    closeServer(frontendServer),
    stopHost(hostBackend),
  ]);
  const shutdownFailures = [frontendCloseResult, hostStopResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  for (const failure of shutdownFailures) {
    logError(failure instanceof Error ? failure.message : failure);
  }
  if (hostStopResult.status === "rejected") {
    throwLauncherShutdownFailures(shutdownFailures);
    return;
  }

  const hostExitCode = await hostBackend.exited;
  if (hostExitCode !== 0) {
    shutdownFailures.push(
      new Error(`OpenDucktor TypeScript host shutdown failed with exit code ${hostExitCode}.`),
    );
  }

  throwLauncherShutdownFailures(shutdownFailures);
};

export const keepProcessAliveDuring = async <T>(
  operation: Promise<T>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Promise<T> => {
  const timer = dependencies.setInterval(() => {}, SHUTDOWN_KEEP_ALIVE_INTERVAL_MS);
  try {
    return await operation;
  } finally {
    dependencies.clearInterval(timer);
  }
};
