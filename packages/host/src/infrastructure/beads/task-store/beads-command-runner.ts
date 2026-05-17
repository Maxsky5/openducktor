import { spawn } from "node:child_process";
import { Effect } from "effect";
import {
  type BeadsCliContext,
  resolveBeadsCliContext,
} from "../../../adapters/beads/beads-cli-context";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { TaskStoreError } from "../../../ports/task-repository-ports";
import {
  BD_COMMAND_TIMEOUT_MS,
  type ResolveBeadsCliContext,
  type RunBd,
  type RunBdJson,
} from "./beads-raw-issue";
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
  onSuccess: (stdout: string) => unknown,
  context?: BeadsCliContext,
  resolveCliContext: ResolveBeadsCliContext = resolveBeadsCliContext,
) =>
  Effect.gen(function* () {
    const cliContext =
      context ??
      (yield* resolveCliContext(repoPath, { requireSharedServer: true }).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "beads.resolveCliContext", {
            repoPath,
            requireSharedServer: true,
          }),
        ),
      ));
    return yield* Effect.async<unknown, TaskStoreError>((resume, signal) => {
      const command = args[0] ?? "unknown";
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("bd", args, {
          cwd: cliContext.workingDir,
          env: cliContext.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (cause) {
        resume(Effect.fail(toBeadsSpawnError(cause, args, repoPath)));
        return;
      }
      if (!child.stdout || !child.stderr) {
        child.kill("SIGTERM");
        resume(
          Effect.fail(
            new HostOperationError({
              operation: "beads.spawn",
              message: `bd ${command} did not expose piped stdout and stderr.`,
              details: { args, command },
            }),
          ),
        );
        return;
      }
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (effect: Effect.Effect<unknown, TaskStoreError>): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        signal.removeEventListener("abort", abort);
        child.off("error", onError);
        child.off("close", onClose);
        resume(effect);
      };
      const abort = (): void => {
        child.kill("SIGTERM");
        finish(
          Effect.fail(
            new HostOperationError({
              operation: "beads.spawn",
              message: `bd ${command} was aborted.`,
              details: { args, command },
            }),
          ),
        );
      };
      const onError = (cause: Error) =>
        finish(Effect.fail(toBeadsSpawnError(cause, args, repoPath)));
      const onClose = (code: number | null) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        if (code !== 0) {
          const output = stderr.trim() || stdout.trim() || "no output";
          finish(
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
        try {
          finish(Effect.succeed(onSuccess(stdout)));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finish(
            Effect.fail(
              new HostValidationError({
                field: "bdJsonOutput",
                message: `Failed to parse bd JSON output from \`bd ${command}\`: ${message}`,
                cause: error,
                details: { args, command },
              }),
            ),
          );
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(
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
    });
  });
export const defaultRunBd =
  (resolveCliContext: ResolveBeadsCliContext): RunBd =>
  (repoPath, args, context) =>
    spawnBd(repoPath, args, (stdout) => stdout, context, resolveCliContext) as Effect.Effect<
      string,
      TaskStoreError
    >;
export const defaultRunBdJson =
  (resolveCliContext: ResolveBeadsCliContext): RunBdJson =>
  (repoPath, args, context) =>
    spawnBd(
      repoPath,
      argsWithJson(args),
      (stdout) => JSON.parse(stdout),
      context,
      resolveCliContext,
    );
