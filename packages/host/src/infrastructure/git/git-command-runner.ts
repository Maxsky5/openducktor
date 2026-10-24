import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  HostValidationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../process/process-command-launch";
import { normalizeProcessEnvironment } from "../process/process-environment";

const execFileAsync = promisify(execFile);
const failedGitCommandSchema = z
  .object({
    stdout: z.union([z.string(), z.instanceof(Buffer)]).optional(),
    stderr: z.union([z.string(), z.instanceof(Buffer).transform(String)]).optional(),
    code: z.union([z.number(), z.string().transform(() => null)]).optional(),
  })
  .passthrough();
export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
};
export type GitCommandError = HostOperationErrorAggregate | HostValidationErrorAggregate;
export type GitCommandRunner = (
  workingDirectory: string,
  args: string[],
  options?: {
    allowFailure?: boolean;
    stdin?: string;
    onStarted?: (() => void) | undefined;
    /**
     * Fails with a validation error on `GIT_OUTPUT_ENCODING_FIELD` when stdout is not UTF-8 text,
     * where default decoding writes U+FFFD. A read with stdin or `onStarted` cannot use it.
     */
    strictUtf8?: boolean;
  },
) => Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  GitCommandError
>;
const createGitEnvironment = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => ({
  ...normalizeProcessEnvironment(env, platform),
  GIT_TERMINAL_PROMPT: "0",
  // Read commands must not rewrite the index while the file tree reads its version.
  GIT_OPTIONAL_LOCKS: "0",
});
/** The validation field of a strict read whose output is not UTF-8 text. */
export const GIT_OUTPUT_ENCODING_FIELD = "gitOutputEncoding";
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
/** A strict read gets stdout as bytes, so its decoding can reject bytes that are not UTF-8. */
const readStdout = (stdout: string | Buffer, strict: boolean, args: string[]) =>
  strict
    ? Effect.try({
        try: () => strictUtf8Decoder.decode(Buffer.from(stdout)),
        catch: () =>
          new HostValidationError({
            message: `git ${args[0] ?? ""} wrote output that is not UTF-8 text.`,
            field: GIT_OUTPUT_ENCODING_FIELD,
          }),
      })
    : Effect.succeed(String(stdout));
export type ResolveGitCommand = () => Effect.Effect<string, HostOperationErrorAggregate>;
export type GitCommandLaunchOptions = (
  | { command: string; resolveCommand?: never }
  | { command?: never; resolveCommand: ResolveGitCommand }
) & {
  platform?: NodeJS.Platform;
};

const createGitCommandResolver = (options: GitCommandLaunchOptions): ResolveGitCommand => {
  let cachedCommand: string | null = null;
  return () => {
    if (cachedCommand !== null) {
      return Effect.succeed(cachedCommand);
    }

    const nextCommand =
      options.resolveCommand === undefined
        ? Effect.succeed(options.command)
        : options.resolveCommand();
    return nextCommand.pipe(
      Effect.tap((resolvedCommand) =>
        Effect.sync(() => {
          cachedCommand = resolvedCommand;
        }),
      ),
    );
  };
};

const runSpawnedGit = (
  workingDirectory: string,
  args: string[],
  options: {
    allowFailure?: boolean;
    stdin: string;
    onStarted?: (() => void) | undefined;
  },
  env: NodeJS.ProcessEnv,
  command: string,
  platform: NodeJS.Platform,
): Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  HostOperationErrorAggregate
> =>
  Effect.callback<
    GitCommandResult & {
      ok: boolean;
    },
    HostOperationErrorAggregate
  >((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      const launch = createProcessCommandLaunch(command, args, env, platform);
      child = spawn(launch.command, launch.args, {
        cwd: workingDirectory,
        env: launch.env,
        windowsHide: launch.windowsHide,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
      if (child.pid !== undefined) options.onStarted?.();
    } catch (cause) {
      resume(Effect.fail(toHostOperationError(cause, "git.spawn", { args, workingDirectory })));
      return;
    }
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill("SIGTERM");
      resume(
        Effect.fail(
          new HostOperationError({
            operation: "git.spawn",
            message: "Failed to start git with piped stdin, stdout, and stderr.",
            details: { args, workingDirectory },
          }),
        ),
      );
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (
      effect: Effect.Effect<
        GitCommandResult & {
          ok: boolean;
        },
        HostOperationErrorAggregate
      >,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
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
            operation: "git.spawn",
            message: "Git command was aborted.",
            details: { args, workingDirectory },
          }),
        ),
      );
    };
    const onError = (cause: Error) =>
      finish(Effect.fail(toHostOperationError(cause, "git.spawn", { args, workingDirectory })));
    const onClose = (code: number | null) => {
      if (code === 0) {
        finish(Effect.succeed({ ok: true, stdout, stderr, exitCode: code }));
        return;
      }
      if (options.allowFailure) {
        finish(Effect.succeed({ ok: false, stdout, stderr, exitCode: code }));
        return;
      }
      finish(
        Effect.fail(
          new HostOperationError({
            operation: "git.spawn",
            message: combineOutput(stdout, stderr),
            details: { args },
          }),
        ),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", onError);
    child.on("close", onClose);
    child.stdin.end(options.stdin);
  });
export const createDefaultGitRunner = (
  readEnv: () => NodeJS.ProcessEnv,
  launchOptions: GitCommandLaunchOptions,
): GitCommandRunner => {
  const resolveCommand = createGitCommandResolver(launchOptions);
  return (workingDirectory, args, options) =>
    Effect.gen(function* () {
      const platform = launchOptions.platform ?? process.platform;
      const commandEnv = createGitEnvironment(readEnv(), platform);
      const command = yield* resolveCommand();
      const spawned = options?.stdin !== undefined || options?.onStarted !== undefined;
      if (spawned && options?.strictUtf8) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "git.spawn",
            message:
              "A Git read with stdin or a start callback cannot check that its output is UTF-8 text.",
            details: { args },
          }),
        );
      }
      if (options?.stdin !== undefined || options?.onStarted !== undefined) {
        return yield* runSpawnedGit(
          workingDirectory,
          args,
          {
            allowFailure: options.allowFailure === true,
            stdin: options.stdin ?? "",
            onStarted: options.onStarted,
          },
          commandEnv,
          command,
          platform,
        );
      }
      const launch = createProcessCommandLaunch(command, args, commandEnv, platform);
      const exit = yield* Effect.result(
        Effect.tryPromise({
          try: (signal) =>
            execFileAsync(launch.command, launch.args, {
              cwd: workingDirectory,
              env: launch.env,
              maxBuffer: 16 * 1024 * 1024,
              encoding: options?.strictUtf8 ? "buffer" : "utf8",
              signal,
              windowsHide: launch.windowsHide,
              windowsVerbatimArguments: launch.windowsVerbatimArguments,
            }),
          catch: (cause) => cause,
        }),
      );
      if (exit._tag === "Success") {
        const stdout = yield* readStdout(exit.success.stdout, options?.strictUtf8 === true, args);
        return { ok: true, stdout, stderr: String(exit.success.stderr), exitCode: 0 };
      }
      if (options?.allowFailure) {
        const failed = exit.failure;
        const parsedFailure = failedGitCommandSchema.safeParse(failed);
        const stdout = parsedFailure.success
          ? yield* readStdout(parsedFailure.data.stdout ?? "", options.strictUtf8 === true, args)
          : "";
        const stderr = parsedFailure.success
          ? (parsedFailure.data.stderr ?? String(failed))
          : String(failed);
        return {
          ok: false,
          stdout,
          stderr,
          exitCode: parsedFailure.success ? (parsedFailure.data.code ?? null) : null,
        };
      }
      return yield* Effect.fail(
        toHostOperationError(exit.failure, "git.execFile", { args, workingDirectory }),
      );
    });
};
export const requireNonEmptyEffect = (
  value: string,
  label: string,
): Effect.Effect<string, HostValidationError> => {
  const trimmed = value.trim();
  return trimmed
    ? Effect.succeed(trimmed)
    : Effect.fail(
        new HostValidationError({
          message: `git ${label} cannot be empty`,
          field: label,
        }),
      );
};
export const combineOutput = (stdout: string, stderr: string): string => {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return output.length > 0 ? output : "no output";
};
export const combineOptionalOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
export const runGit = (runner: GitCommandRunner, workingDirectory: string, args: string[]) =>
  Effect.gen(function* () {
    const result = yield* runner(workingDirectory, args);
    return result.stdout;
  });
/** Reads output that a write applies again, so a byte that is not UTF-8 fails the read. */
export const runGitStrictUtf8 = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
) =>
  Effect.gen(function* () {
    const result = yield* runner(workingDirectory, args, { strictUtf8: true });
    return result.stdout;
  });
export const runGitAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
): Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  GitCommandError
> => runner(workingDirectory, args, { allowFailure: true });
export const runGitWithStdinAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
  stdin: string,
): Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  GitCommandError
> => runner(workingDirectory, args, { allowFailure: true, stdin });
export const referenceExists = (
  runner: GitCommandRunner,
  workingDirectory: string,
  reference: string,
) =>
  Effect.gen(function* () {
    const targetRef = yield* requireNonEmptyEffect(reference, "reference");
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "--verify",
      "--quiet",
      targetRef,
    ]);
    return result.ok;
  });
export const resolveGitCommonDirectory = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, workingDirectory, ["rev-parse", "--git-common-dir"]);
    const commonDir = output.trim();
    if (!commonDir) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Git common directory is empty for ${workingDirectory}`,
          field: "gitCommonDir",
          details: { workingDirectory },
        }),
      );
    }
    const absoluteCommonDir = path.isAbsolute(commonDir)
      ? commonDir
      : path.join(workingDirectory, commonDir);
    return yield* Effect.tryPromise({
      try: () => realpath(absoluteCommonDir),
      catch: (cause) => toHostOperationError(cause, "git.resolveGitCommonDirectory.realpath"),
    });
  });
/** One process reads the work tree state, checkout root, and shared Git directory. */
export const readGitCheckout = (runner: GitCommandRunner, directory: string) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, directory, [
      "rev-parse",
      "--is-inside-work-tree",
      "--show-toplevel",
      "--git-common-dir",
    ]);
    // Git fails outside a repository and inside a Git directory, which has no work tree.
    if (!result.ok) return null;
    const [insideWorkTree, root, commonDirectory] = result.stdout.split(/\r?\n/u);
    if (insideWorkTree !== "true") return null;
    if (!root || !commonDirectory) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.readCheckout",
          message: `Git returned an incomplete checkout for ${directory}.`,
          details: { directory, output: result.stdout },
        }),
      );
    }
    return yield* Effect.tryPromise({
      try: async () => ({
        root: await realpath(root),
        // Git prints the shared Git directory relative to the directory that it reads.
        commonDirectory: await realpath(path.resolve(directory, commonDirectory)),
      }),
      catch: (cause) => toHostOperationError(cause, "git.readCheckout.realpath", { directory }),
    });
  });
/** The real path of a path, or null when the path is missing. */
export const realPathIfPresent = (inputPath: string) =>
  Effect.tryPromise({
    try: () => realpath(inputPath),
    catch: (cause) => toHostPathStatError(cause, "git.realPath", inputPath),
  }).pipe(Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(null)));
export const pathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => stat(inputPath),
    catch: (cause) => toHostPathStatError(cause, "git.pathExists", inputPath),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );
