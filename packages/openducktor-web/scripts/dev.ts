import path from "node:path";
import { fileURLToPath } from "node:url";

type ManagedWebProcess = Bun.Subprocess<"ignore", "inherit", "inherit">;
type KeepAliveTimer = ReturnType<typeof setInterval>;
type ProcessKeepAliveDependencies = {
  clearInterval: (timer: KeepAliveTimer) => void;
  setInterval: (callback: () => void, durationMs: number) => KeepAliveTimer;
};

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), "..");
const WEB_STOP_TIMEOUT_MS = 30_000;
const WEB_SHUTDOWN_KEEP_ALIVE_INTERVAL_MS = 1_000;

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const waitForProcessExit = async (
  subprocess: Pick<ManagedWebProcess, "exited">,
  timeoutMs: number,
): Promise<boolean> => {
  let exited = false;
  await Promise.race([
    subprocess.exited.then(() => {
      exited = true;
    }),
    sleep(timeoutMs),
  ]);
  return exited;
};

export const shouldDetachWebProcessGroup = (
  platform: NodeJS.Platform = process.platform,
): boolean => platform !== "win32";

export const buildWebDevCommand = (
  args: readonly string[],
  bunExecutable = process.execPath,
): string[] => [bunExecutable, "src/cli.ts", "--workspace", ...args];

export const buildWebDevProcessEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => ({
  ...env,
  FORCE_COLOR: env.FORCE_COLOR ?? "1",
});

export const keepWebDevProcessAliveDuring = async <T>(
  operation: Promise<T>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Promise<T> => {
  const timer = dependencies.setInterval(() => {}, WEB_SHUTDOWN_KEEP_ALIVE_INTERVAL_MS);
  try {
    return await operation;
  } finally {
    dependencies.clearInterval(timer);
  }
};

const startWebCli = (args: readonly string[]): ManagedWebProcess =>
  Bun.spawn(buildWebDevCommand(args), {
    cwd: packageRoot,
    detached: shouldDetachWebProcessGroup(),
    stdout: "inherit",
    stderr: "inherit",
    env: buildWebDevProcessEnvironment(),
  });

const stopWebCli = async (webCli: ManagedWebProcess | null): Promise<void> => {
  if (!webCli) {
    return;
  }

  webCli.kill();
  if (await waitForProcessExit(webCli, WEB_STOP_TIMEOUT_MS)) {
    return;
  }

  webCli.kill(9);
  await waitForProcessExit(webCli, WEB_STOP_TIMEOUT_MS);
};

export const runWebDev = async (
  args: readonly string[] = process.argv.slice(2),
): Promise<number> => {
  const webCli = startWebCli(args);
  let webCliExited = false;
  let shutdownStarted = false;
  let resolveExit: (exitCode: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    await keepWebDevProcessAliveDuring(stopWebCli(webCli));
    resolveExit(exitCode);
  };

  void webCli.exited.then((exitCode) => {
    webCliExited = true;
    if (!shutdownStarted) {
      void shutdown(exitCode);
    }
  });

  process.on("SIGINT", () => {
    void shutdown(130);
  });
  process.on("SIGTERM", () => {
    void shutdown(143);
  });
  process.once("exit", () => {
    if (!webCliExited) {
      webCli.kill();
    }
  });

  return exited;
};

if (import.meta.main) {
  const exitCode = await runWebDev().catch((error: unknown) => {
    console.error(error);
    return 1;
  });
  process.exit(exitCode);
}
