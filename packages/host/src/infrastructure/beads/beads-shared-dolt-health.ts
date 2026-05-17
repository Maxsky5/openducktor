import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import { Effect } from "effect";
import { processIsAlive } from "../../adapters/process/process-tree";
import { toHostPathStatError } from "../../effect/host-errors";
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
  Effect.async<boolean>((resume) => {
    const socket = net.createConnection({ host: SHARED_DOLT_SERVER_HOST, port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resume(Effect.succeed(result));
    };
    socket.setTimeout(SHARED_DOLT_TCP_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

export const runDoltAllowFailure = (
  args: string[],
  env: NodeJS.ProcessEnv,
): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume) => {
    const child = spawn("dolt", args, {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => resume(Effect.succeed(false)));
    child.once("close", (code) => resume(Effect.succeed(code === 0)));
  });

export const runCommandAllowFailure: BeadsCommandRunner = ({ command, args, cwd, env }) =>
  Effect.async<BeadsCommandResult, SharedDoltServerError>((resume) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      resume(Effect.fail(toSharedDoltServerError(cause, "shared-dolt.run-command")));
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
      resume(effect);
    };
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", (cause) =>
      finish(Effect.fail(toSharedDoltServerError(cause, "shared-dolt.run-command"))),
    );
    child.once("close", (code) => {
      finish(
        Effect.succeed({
          ok: code === 0,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        }),
      );
    });
  });

export const sqlProbe = (port: number, env: NodeJS.ProcessEnv): Effect.Effect<boolean> =>
  runDoltAllowFailure(
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
    if (!(yield* tcpProbe(state.port)) || !(yield* sqlProbe(state.port, paths.env))) {
      return false;
    }
    return processIsAlive(state.pid);
  });

export const waitForServerReady = (port: number, env: NodeJS.ProcessEnv): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = Date.now() + SHARED_DOLT_HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((yield* tcpProbe(port)) && (yield* sqlProbe(port, env))) {
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
