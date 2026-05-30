import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { Effect } from "effect";
import type { BeadsCliContext } from "../../../adapters/beads/beads-cli-context";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import { createProcessCommandLaunch } from "../../process/process-command-launch";
import {
  BD_COMMAND_TIMEOUT_MS,
  type BeadsCommandJsonOutput,
  type ResolveBeadsCliContext,
  type RunBd,
  type RunBdJson,
} from "./beads-raw-issue";

type BdChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export const argsWithJson = (args: string[]): string[] => {
  const delimiterIndex = args.indexOf("--");
  if (delimiterIndex >= 0) {
    return [...args.slice(0, delimiterIndex), "--json", "--", ...args.slice(delimiterIndex + 1)];
  }
  return [...args, "--json"];
};
const toBeadsSpawnError = (cause: unknown, args: string[], repoPath: string): TaskStoreError => {
  if (cause instanceof HostOperationError || cause instanceof HostValidationError) {
    return cause;
  }
  return toHostOperationError(cause, "beads.spawn", { args, repoPath });
};
export const spawnBd = (
  repoPath: string,
  args: string[],
  onSuccess: (stdout: string) => string,
  context: BeadsCliContext | undefined,
  resolveCliContext: ResolveBeadsCliContext,
): Effect.Effect<string, TaskStoreError> =>
  spawnBdWithParser(repoPath, args, onSuccess, context, resolveCliContext);

export const spawnBdJson = (
  repoPath: string,
  args: string[],
  onSuccess: (stdout: string) => BeadsCommandJsonOutput,
  context: BeadsCliContext | undefined,
  resolveCliContext: ResolveBeadsCliContext,
): Effect.Effect<BeadsCommandJsonOutput, TaskStoreError> =>
  spawnBdWithParser(repoPath, args, onSuccess, context, resolveCliContext);

const resolveCliContextForBd = (
  repoPath: string,
  context: BeadsCliContext | undefined,
  resolveCliContext: ResolveBeadsCliContext,
) =>
  context
    ? Effect.succeed(context)
    : resolveCliContext(repoPath, { requireSharedServer: true }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "beads.resolveCliContext", {
            repoPath,
            requireSharedServer: true,
          }),
        ),
      );

const spawnBdProcess = (
  repoPath: string,
  args: string[],
  cliContext: BeadsCliContext,
): Effect.Effect<BdChildProcess, TaskStoreError> =>
  Effect.try({
    try: () => {
      const launch = createProcessCommandLaunch(
        cliContext.tools.beads,
        args,
        cliContext.env,
        process.platform,
      );
      return spawn(launch.command, launch.args, {
        cwd: cliContext.workingDir,
        env: launch.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
    },
    catch: (cause) => toBeadsSpawnError(cause, args, repoPath),
  });

const waitForBdStdout = (
  child: BdChildProcess,
  repoPath: string,
  args: string[],
): Effect.Effect<string, TaskStoreError> =>
  Effect.async<string, TaskStoreError>((resume) => {
    const command = args[0] ?? "unknown";
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const complete = (effect: Effect.Effect<string, TaskStoreError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      child.off("error", onError);
      child.off("close", onClose);
      resume(effect);
    };

    const onError = (cause: Error): void => {
      complete(Effect.fail(toBeadsSpawnError(cause, args, repoPath)));
    };

    const onClose = (code: number | null): void => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        const output = stderr.trim() || stdout.trim() || "no output";
        complete(
          Effect.fail(
            new HostOperationError({
              operation: "beads.spawn",
              message: `bd ${command} failed with code ${code}: ${output}`,
              details: { args, command, exitCode: code },
            }),
          ),
        );
        return;
      }
      complete(Effect.succeed(stdout));
    };

    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      complete(
        Effect.fail(
          new HostOperationError({
            operation: "beads.spawn",
            message: `Timed out running bd ${command} after ${BD_COMMAND_TIMEOUT_MS}ms`,
            details: { args, command, timeoutMs: BD_COMMAND_TIMEOUT_MS },
          }),
        ),
      );
    }, BD_COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", onError);
    child.once("close", onClose);

    return Effect.sync(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      child.off("error", onError);
      child.off("close", onClose);
      child.kill("SIGTERM");
    });
  });

const parseBdStdout = <A>(
  args: string[],
  stdout: string,
  parse: (stdout: string) => A,
): Effect.Effect<A, HostValidationError> =>
  Effect.try({
    try: () => parse(stdout),
    catch: (error) => {
      const command = args[0] ?? "unknown";
      const message = error instanceof Error ? error.message : String(error);
      return new HostValidationError({
        field: "bdJsonOutput",
        message: `Failed to parse bd JSON output from \`bd ${command}\`: ${message}`,
        cause: error,
        details: { args, command },
      });
    },
  });

const spawnBdWithParser = <A>(
  repoPath: string,
  args: string[],
  onSuccess: (stdout: string) => A,
  context: BeadsCliContext | undefined,
  resolveCliContext: ResolveBeadsCliContext,
): Effect.Effect<A, TaskStoreError> =>
  Effect.gen(function* () {
    const cliContext = yield* resolveCliContextForBd(repoPath, context, resolveCliContext);
    const child = yield* spawnBdProcess(repoPath, args, cliContext);
    const stdout = yield* waitForBdStdout(child, repoPath, args);
    return yield* parseBdStdout(args, stdout, onSuccess);
  });
export const defaultRunBd =
  (resolveCliContext: ResolveBeadsCliContext): RunBd =>
  (repoPath, args, context) =>
    spawnBd(repoPath, args, (stdout) => stdout, context, resolveCliContext);
export const defaultRunBdJson =
  (resolveCliContext: ResolveBeadsCliContext): RunBdJson =>
  (repoPath, args, context) =>
    spawnBdJson(
      repoPath,
      argsWithJson(args),
      (stdout) => JSON.parse(stdout),
      context,
      resolveCliContext,
    );
