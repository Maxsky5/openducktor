import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { errorMessage, runWebBoundary, WebDependencyError } from "../src/effect/web-errors";

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

const waitForProcessExitEffect = (
  subprocess: Pick<ManagedWebProcess, "exited">,
  timeoutMs: number,
): Effect.Effect<boolean, WebDependencyError> =>
  Effect.gen(function* () {
    let exited = false;
    yield* Effect.tryPromise({
      try: () =>
        Promise.race([
          subprocess.exited.then(() => {
            exited = true;
          }),
          sleep(timeoutMs),
        ]),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "web-cli-process",
          operation: "await-exit",
          message: errorMessage(cause),
          cause,
          details: { timeoutMs },
        }),
    });
    return exited;
  });

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

export const keepWebDevProcessAliveDuringEffect = <T, E>(
  operation: Effect.Effect<T, E>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Effect.Effect<T, E> =>
  Effect.acquireUseRelease(
    Effect.sync(() => dependencies.setInterval(() => {}, WEB_SHUTDOWN_KEEP_ALIVE_INTERVAL_MS)),
    () => operation,
    (timer) => Effect.sync(() => dependencies.clearInterval(timer)),
  );

export const keepWebDevProcessAliveDuring = <T>(
  operation: Promise<T>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Promise<T> =>
  runWebBoundary(
    keepWebDevProcessAliveDuringEffect(
      Effect.tryPromise({
        try: () => operation,
        catch: (cause) =>
          new WebDependencyError({
            dependency: "web-dev-operation",
            operation: "keep-process-alive",
            message: errorMessage(cause),
            cause,
          }),
      }),
      dependencies,
    ),
  );

const startWebCliEffect = (
  args: readonly string[],
): Effect.Effect<ManagedWebProcess, WebDependencyError> =>
  Effect.try({
    try: () =>
      Bun.spawn(buildWebDevCommand(args), {
        cwd: packageRoot,
        detached: shouldDetachWebProcessGroup(),
        stdout: "inherit",
        stderr: "inherit",
        env: buildWebDevProcessEnvironment(),
      }),
    catch: (cause) =>
      new WebDependencyError({
        dependency: "web-cli-process",
        operation: "spawn",
        message: errorMessage(cause),
        cause,
        details: { args },
      }),
  });

const stopWebCliEffect = (
  webCli: ManagedWebProcess | null,
): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    if (!webCli) {
      return;
    }

    yield* Effect.sync(() => webCli.kill());
    if (yield* waitForProcessExitEffect(webCli, WEB_STOP_TIMEOUT_MS)) {
      return;
    }

    yield* Effect.sync(() => webCli.kill(9));
    yield* waitForProcessExitEffect(webCli, WEB_STOP_TIMEOUT_MS);
  });

export const runWebDevEffect = (
  args: readonly string[] = process.argv.slice(2),
): Effect.Effect<number, WebDependencyError> =>
  Effect.gen(function* () {
    const webCli = yield* startWebCliEffect(args);
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
      await runWebBoundary(keepWebDevProcessAliveDuringEffect(stopWebCliEffect(webCli)));
      resolveExit(exitCode);
    };

    yield* Effect.sync(() => {
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
    });

    return yield* Effect.tryPromise({
      try: () => exited,
      catch: (cause) =>
        new WebDependencyError({
          dependency: "web-dev-supervisor",
          operation: "await-exit",
          message: errorMessage(cause),
          cause,
        }),
    });
  });

export const runWebDev = (args: readonly string[] = process.argv.slice(2)): Promise<number> =>
  runWebBoundary(runWebDevEffect(args));

if (import.meta.main) {
  const exitCode = await runWebDev().catch((error: unknown) => {
    console.error(error);
    return 1;
  });
  process.exit(exitCode);
}
