import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

export type GitCommandRunner = (
  workingDirectory: string,
  args: string[],
  options?: { allowFailure?: boolean; stdin?: string },
) => Promise<GitCommandResult & { ok: boolean }>;

export const createGitEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  GIT_TERMINAL_PROMPT: "0",
});

export const runSpawnedGit = (
  workingDirectory: string,
  args: string[],
  options: { allowFailure?: boolean; stdin: string },
  env: NodeJS.ProcessEnv,
): Promise<GitCommandResult & { ok: boolean }> =>
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

      reject(new Error(combineOutput(stdout, stderr)));
    });
    child.stdin.end(options.stdin);
  });

export const createDefaultGitRunner =
  (env: NodeJS.ProcessEnv): GitCommandRunner =>
  async (workingDirectory, args, options) => {
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

    try {
      const output = await execFileAsync("git", args, {
        cwd: workingDirectory,
        env: createGitEnvironment(env),
        maxBuffer: 16 * 1024 * 1024,
      });
      return { ok: true, stdout: output.stdout, stderr: output.stderr };
    } catch (error) {
      if (options?.allowFailure) {
        const failed = error as { stdout?: string; stderr?: string };
        return {
          ok: false,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? String(error),
        };
      }

      throw error;
    }
  };

export const requireNonEmpty = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`git ${label} cannot be empty`);
  }

  return trimmed;
};

export const combineOutput = (stdout: string, stderr: string): string => {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return output.length > 0 ? output : "no output";
};

export const combineOptionalOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

export const runGit = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
): Promise<string> => {
  const result = await runner(workingDirectory, args);
  return result.stdout;
};

export const runGitAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
): Promise<GitCommandResult & { ok: boolean }> =>
  runner(workingDirectory, args, { allowFailure: true });

export const runGitWithStdinAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
  stdin: string,
): Promise<GitCommandResult & { ok: boolean }> =>
  runner(workingDirectory, args, { allowFailure: true, stdin });

export const referenceExists = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  reference: string,
): Promise<boolean> => {
  const targetRef = requireNonEmpty(reference, "reference");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "rev-parse",
    "--verify",
    "--quiet",
    targetRef,
  ]);
  return result.ok;
};

export const resolveGitCommonDirectory = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<string> => {
  const output = await runGit(runner, workingDirectory, ["rev-parse", "--git-common-dir"]);
  const commonDir = output.trim();
  if (!commonDir) {
    throw new Error(`Git common directory is empty for ${workingDirectory}`);
  }

  const absoluteCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.join(workingDirectory, commonDir);
  return realpath(absoluteCommonDir);
};

export const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await stat(inputPath);
    return true;
  } catch {
    return false;
  }
};
