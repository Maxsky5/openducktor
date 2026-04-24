import { randomUUID } from "node:crypto";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { type ResolvedHostBinary, resolveHostBinary } from "./artifact-resolver";

export type LauncherOptions = {
  packageRoot: string;
  workspaceRoot?: string;
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  explicitHostBinary?: string;
  readinessTimeoutMs?: number;
};

type ManagedProcess = Bun.Subprocess;
type BackendReadinessDependencies = {
  fetch: typeof fetch;
  sleep: (durationMs: number) => Promise<unknown>;
};

const LOCALHOST = "127.0.0.1";
const CONTROL_TOKEN_HEADER = "x-openducktor-control-token";

const buildFrontendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;
const buildBackendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

const spawnHost = (
  resolved: ResolvedHostBinary,
  backendPort: number,
  frontendOrigin: string,
  controlToken: string,
  appToken: string,
): ManagedProcess => {
  const hostArgs = [
    "--port",
    String(backendPort),
    "--frontend-origin",
    frontendOrigin,
    "--control-token",
    controlToken,
    "--app-token",
    appToken,
  ];

  if (resolved.kind === "workspace") {
    return Bun.spawn({
      cmd: [resolved.command, ...resolved.args, ...hostArgs],
      cwd: resolved.cwd,
      detached: true,
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });
  }

  return Bun.spawn({
    cmd: [resolved.path, ...hostArgs],
    cwd: path.dirname(resolved.path),
    detached: true,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
};

const requestHostShutdown = async (
  backendUrl: string,
  controlToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(`${backendUrl}/shutdown`, {
      method: "POST",
      headers: {
        [CONTROL_TOKEN_HEADER]: controlToken,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenDucktor web host shutdown failed with status ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

const terminateProcessGroup = async (child: ManagedProcess | null): Promise<void> => {
  if (!child) {
    return;
  }

  const pid = child.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }

  child.kill();
  await Promise.race([child.exited, Bun.sleep(3_000)]);

  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, 0);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    } catch {}
  }

  child.kill(9);
  await Promise.race([child.exited, Bun.sleep(1_000)]);
};

const waitForBackend = async (
  backendUrl: string,
  timeoutMs: number,
  hostProcess: ManagedProcess,
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
      const response = await dependencies.fetch(`${backendUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health endpoint returned ${response.status}.`);
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

const buildViteDefine = (backendUrl: string, appToken: string): Record<string, string> => ({
  "import.meta.env.VITE_ODT_BROWSER_BACKEND_URL": JSON.stringify(backendUrl),
  "import.meta.env.VITE_ODT_BROWSER_AUTH_TOKEN": JSON.stringify(appToken),
  "import.meta.env.VITE_ODT_APP_MODE": JSON.stringify("browser"),
});

export const __launcherTestInternals = {
  buildViteDefine,
  requestHostShutdown,
  waitForBackend,
};

const startViteServer = async (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
): Promise<ViteDevServer> => {
  const server = await createServer({
    root: options.packageRoot,
    configFile: path.join(options.packageRoot, "vite.config.ts"),
    server: {
      host: LOCALHOST,
      port: options.frontendPort,
      strictPort: true,
    },
    define: buildViteDefine(backendUrl, appToken),
  });

  await server.listen(options.frontendPort);
  server.printUrls();
  return server;
};

export const runLauncher = async (options: LauncherOptions): Promise<number> => {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000;
  const frontendUrl = buildFrontendUrl(options.frontendPort);
  const backendUrl = buildBackendUrl(options.backendPort);
  const controlToken = randomUUID();
  const appToken = randomUUID();
  const hostOptions = {
    packageRoot: options.packageRoot,
    workspaceMode: options.workspaceMode,
  };
  const resolvedHost = resolveHostBinary({
    ...hostOptions,
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    ...(options.explicitHostBinary ? { explicitBinaryPath: options.explicitHostBinary } : {}),
  });

  const hostProcess = spawnHost(
    resolvedHost,
    options.backendPort,
    frontendUrl,
    controlToken,
    appToken,
  );
  let viteServer: ViteDevServer | null = null;
  let stopping = false;

  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;

    const shutdownResults = await Promise.allSettled([
      requestHostShutdown(backendUrl, controlToken),
      viteServer?.close() ?? Promise.resolve(),
    ]);

    const shutdownError = shutdownResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (shutdownError) {
      console.error(
        shutdownError.reason instanceof Error ? shutdownError.reason.message : shutdownError.reason,
      );
    }

    await Promise.race([hostProcess.exited, Bun.sleep(4_000)]);
    await terminateProcessGroup(hostProcess);
  };

  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(143));
  });

  try {
    await waitForBackend(backendUrl, readinessTimeoutMs, hostProcess);
    viteServer = await startViteServer(options, backendUrl, appToken);
    console.log(`OpenDucktor web is ready: ${frontendUrl}`);

    const exitCode = await hostProcess.exited;
    await viteServer.close();
    return exitCode;
  } catch (error) {
    await stop();
    throw error;
  }
};
