import { chmod, rm } from "node:fs/promises";
import process from "node:process";

type RunCommandInput = {
  command: readonly [string, ...string[]];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
};

export const cleanDirectory = async (path: string): Promise<void> => {
  await rm(path, { force: true, recursive: true });
};

export const markExecutable = async (path: string): Promise<void> => {
  if (process.platform === "win32") {
    return;
  }

  await chmod(path, 0o755);
};

export const runCommand = async ({ command, cwd, env, label }: RunCommandInput): Promise<void> => {
  const spawnOptions = {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  } as const;
  const subprocess = Bun.spawn(
    [...command],
    env ? { ...spawnOptions, env: { ...process.env, ...env } } : spawnOptions,
  );
  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
};
