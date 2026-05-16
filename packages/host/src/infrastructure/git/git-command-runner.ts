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
export const execFileAsync = promisify(execFile);
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
export const createGitEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  GIT_TERMINAL_PROMPT: "0",
});
export const runSpawnedGit = (
  workingDirectory: string,
  args: string[],
  options: {
    allowFailure?: boolean;
    stdin: string;
  },
  env: NodeJS.ProcessEnv,
): Effect.Effect<
  GitCommandResult & {
    ok: boolean;
  },
  HostOperationError
> =>
  Effect.tryPromise({
    try: () =>
      new Promise((resolve, reject) => {
        const child = spawn("git", args, {
          cwd: workingDirectory,
          env: createGitEnvironment(env),
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve({ ok: true, stdout, stderr });
            return;
          }
          if (options.allowFailure) {
            resolve({ ok: false, stdout, stderr });
            return;
          }
          reject(
            new HostOperationError({
              operation: "git.spawn",
              message: combineOutput(stdout, stderr),
              details: { args },
            }),
          );
        });
        child.stdin.end(options.stdin);
      }),
    catch: (cause) => toHostOperationError(cause, "git.spawn", { args, workingDirectory }),
  });
export const createDefaultGitRunner =
  (env: NodeJS.ProcessEnv): GitCommandRunner =>
  (workingDirectory, args, options) => {
    if (options?.stdin !== undefined) {
      return runSpawnedGit(
        workingDirectory,
        args,
        {
          allowFailure: options.allowFailure === true,
          stdin: options.stdin,
        },
        env,
      );
    }
    return Effect.tryPromise({
      try: () =>
        execFileAsync("git", args, {
          cwd: workingDirectory,
          env: createGitEnvironment(env),
          maxBuffer: 16 * 1024 * 1024,
        })
          .then((output) => ({ ok: true, stdout: output.stdout, stderr: output.stderr }))
          .catch((error) => {
            if (options?.allowFailure) {
              const failed = error as {
                stdout?: string;
                stderr?: string;
              };
              return {
                ok: false,
                stdout: failed.stdout ?? "",
                stderr: failed.stderr ?? String(error),
              };
            }
            throw error;
          }),
      catch: (cause) => toHostOperationError(cause, "git.execFile", { args, workingDirectory }),
    });
  };
export const requireNonEmpty = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HostValidationError({
      message: `git ${label} cannot be empty`,
      field: label,
    });
  }
  return trimmed;
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
    const targetRef = requireNonEmpty(reference, "reference");
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
      throw new HostValidationError({
        message: `Git common directory is empty for ${workingDirectory}`,
        field: "gitCommonDir",
        details: { workingDirectory },
      });
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
