import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../process/process-command-launch";
import { normalizeProcessEnvironment } from "../process/process-environment";

const execFileAsync = promisify(execFile);
export type GitCommandResult = {
  stdout: string;
  stderr: string;
};
export type GitCommandError = HostOperationError | HostValidationError;
export type GitCommandRunner = (
  workingDirectory: string,
  args: string[],
  options?: {
    allowFailure?: boolean;
    stdin?: string;
  },
) => Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  GitCommandError
>;
/** @internal Test-only seam for Git environment normalization. */
export const createGitEnvironment = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => ({
  ...normalizeProcessEnvironment(env, platform),
  GIT_TERMINAL_PROMPT: "0",
});
export type ResolveGitCommand = () => Effect.Effect<string, HostOperationError>;
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
  },
  env: NodeJS.ProcessEnv,
  command: string,
  platform: NodeJS.Platform,
): Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  HostOperationError
> =>
  Effect.async<
    GitCommandResult & {
      ok: boolean;
    },
    HostOperationError
  >((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      const launch = createProcessCommandLaunch(command, args, env, platform);
      child = spawn(launch.command, launch.args, {
        cwd: workingDirectory,
        env: launch.env,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
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
        HostOperationError
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
        finish(Effect.succeed({ ok: true, stdout, stderr }));
        return;
      }
      if (options.allowFailure) {
        finish(Effect.succeed({ ok: false, stdout, stderr }));
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
  env: NodeJS.ProcessEnv,
  launchOptions: GitCommandLaunchOptions,
): GitCommandRunner => {
  const resolveCommand = createGitCommandResolver(launchOptions);
  return (workingDirectory, args, options) =>
    Effect.gen(function* () {
      const platform = launchOptions.platform ?? process.platform;
      const commandEnv = createGitEnvironment(env, platform);
      const command = yield* resolveCommand();
      if (options?.stdin !== undefined) {
        return yield* runSpawnedGit(
          workingDirectory,
          args,
          {
            allowFailure: options.allowFailure === true,
            stdin: options.stdin,
          },
          commandEnv,
          command,
          platform,
        );
      }
      const launch = createProcessCommandLaunch(command, args, commandEnv, platform);
      const exit = yield* Effect.either(
        Effect.tryPromise({
          try: () =>
            execFileAsync(launch.command, launch.args, {
              cwd: workingDirectory,
              env: launch.env,
              maxBuffer: 16 * 1024 * 1024,
              windowsVerbatimArguments: launch.windowsVerbatimArguments,
            }),
          catch: (cause) => cause,
        }),
      );
      if (exit._tag === "Right") {
        return { ok: true, stdout: exit.right.stdout, stderr: exit.right.stderr };
      }
      if (options?.allowFailure) {
        const failed = exit.left as {
          stdout?: string;
          stderr?: string;
        };
        return {
          ok: false,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? String(exit.left),
        };
      }
      return yield* Effect.fail(
        toHostOperationError(exit.left, "git.execFile", { args, workingDirectory }),
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
export const pathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => stat(inputPath),
    catch: (cause) => toHostPathStatError(cause, "git.pathExists", inputPath),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );
