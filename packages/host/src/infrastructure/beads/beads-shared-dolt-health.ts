import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import { Clock, Effect } from "effect";
import { toHostPathStatError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../process/process-command-launch";
import { processIsAlive } from "../process/process-tree";
import {
  type BeadsCommandRunner,
  type BeadsSharedServerPaths,
  type BeadsSharedServerState,
  MAX_DOLT_STARTUP_LOG_CHARS,
  SHARED_DOLT_HEALTH_POLL_INTERVAL_MS,
  SHARED_DOLT_HEALTH_TIMEOUT_MS,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  SHARED_DOLT_TCP_TIMEOUT_MS,
} from "./beads-context-model";
import { type SharedDoltServerError, toSharedDoltServerError } from "./beads-shared-dolt-errors";

type BeadsCommandResult = { ok: boolean; stdout: string; stderr: string };

export const pathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => access(inputPath),
    catch: (cause) => toHostPathStatError(cause, "shared-dolt.path-exists", inputPath),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );

export const tcpProbe = (port: number): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume, signal) => {
    let socket: net.Socket;
    try {
      socket = net.createConnection({ host: SHARED_DOLT_SERVER_HOST, port });
    } catch {
      resume(Effect.succeed(false));
      return;
    }
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.off("connect", onConnect);
      socket.off("timeout", onTimeout);
      socket.off("error", onError);
      socket.destroy();
      resume(Effect.succeed(result));
    };
    const abort = () => finish(false);
    const onConnect = () => finish(true);
    const onTimeout = () => finish(false);
    const onError = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    socket.setTimeout(SHARED_DOLT_TCP_TIMEOUT_MS);
    socket.once("connect", onConnect);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
  });

export const runDoltAllowFailure = (
  doltCommand: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      const launch = createProcessCommandLaunch(doltCommand, args, env, process.platform);
      child = spawn(launch.command, launch.args, {
        env: launch.env,
        stdio: ["ignore", "ignore", "ignore"],
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
    } catch {
      resume(Effect.succeed(false));
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      child.off("error", onError);
      child.off("close", onClose);
      resume(Effect.succeed(ok));
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(false);
    };
    const onError = () => finish(false);
    const onClose = (code: number | null) => finish(code === 0);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.once("error", onError);
    child.once("close", onClose);
  });

export const runCommandAllowFailure: BeadsCommandRunner = ({ command, args, cwd, env }) =>
  Effect.async<BeadsCommandResult, SharedDoltServerError>((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      const launch = createProcessCommandLaunch(
        command,
        args,
        env ?? process.env,
        process.platform,
      );
      child = spawn(launch.command, launch.args, {
        cwd,
        env: launch.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
    } catch (cause) {
      resume(Effect.fail(toSharedDoltServerError(cause, "shared-dolt.run-command")));
      return;
    }
    if (!child.stdout || !child.stderr) {
      child.kill("SIGTERM");
      resume(
        Effect.fail(
          toSharedDoltServerError(
            new Error(`Command ${command} did not expose piped stdout and stderr.`),
            "shared-dolt.run-command",
          ),
        ),
      );
      return;
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const finish = (effect: Effect.Effect<BeadsCommandResult, SharedDoltServerError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      child.off("error", onError);
      child.off("close", onClose);
      resume(effect);
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(
        Effect.fail(
          toSharedDoltServerError(
            new Error(`Command ${command} was aborted.`),
            "shared-dolt.run-command",
          ),
        ),
      );
    };
    const onError = (cause: Error) =>
      finish(Effect.fail(toSharedDoltServerError(cause, "shared-dolt.run-command")));
    const onClose = (code: number | null) => {
      finish(
        Effect.succeed({
          ok: code === 0,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        }),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", onError);
    child.once("close", onClose);
  });

export const sqlProbe = (
  port: number,
  env: NodeJS.ProcessEnv,
  doltCommand: string,
): Effect.Effect<boolean> =>
  runDoltAllowFailure(
    doltCommand,
    [
      "--host",
      SHARED_DOLT_SERVER_HOST,
      "--port",
      String(port),
      "--no-tls",
      "-u",
      SHARED_DOLT_SERVER_USER,
      "-p",
      "",
      "sql",
      "-q",
      "show databases",
    ],
    env,
  );

export const serverStateIsHealthy = (
  state: BeadsSharedServerState,
  paths: BeadsSharedServerPaths,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (state.host !== SHARED_DOLT_SERVER_HOST || state.user !== SHARED_DOLT_SERVER_USER) {
      return false;
    }
    if (state.sharedServerRoot !== paths.sharedServerRoot || state.doltDataDir !== paths.doltRoot) {
      return false;
    }
    if (
      !(yield* tcpProbe(state.port)) ||
      !(yield* sqlProbe(state.port, paths.env, paths.tools.dolt))
    ) {
      return false;
    }
    return processIsAlive(state.pid);
  });

export const waitForServerReady = (
  port: number,
  env: NodeJS.ProcessEnv,
  doltCommand: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const deadline = startedAt + SHARED_DOLT_HEALTH_TIMEOUT_MS;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      if ((yield* tcpProbe(port)) && (yield* sqlProbe(port, env, doltCommand))) {
        return true;
      }
      yield* Effect.sleep(`${SHARED_DOLT_HEALTH_POLL_INTERVAL_MS} millis`);
    }
    return false;
  });

export const formatDoltStartupLog = (output: string): string => {
  const cleaned = output.replaceAll("\0", "").trim();
  if (cleaned.length <= MAX_DOLT_STARTUP_LOG_CHARS) {
    return cleaned;
  }
  return cleaned.slice(cleaned.length - MAX_DOLT_STARTUP_LOG_CHARS);
};
