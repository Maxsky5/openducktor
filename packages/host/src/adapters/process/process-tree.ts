import { spawnSync } from "node:child_process";

export type ProcessTreePlatform = NodeJS.Platform;

type SignalProcessTreeDependencies = {
  platform?: ProcessTreePlatform;
  kill?: typeof process.kill;
  spawnSync?: typeof spawnSync;
  isAlive?: (pid: number) => boolean;
};

export type TerminateProcessTreeInput = {
  pid: number;
  label: string;
  isClosed: () => boolean;
  waitForExit: (timeoutMs: number) => Promise<boolean>;
  stopTimeoutMs: number;
  signalDependencies?: SignalProcessTreeDependencies;
};

export const processIsAlive = (pid: number, kill: typeof process.kill = process.kill): boolean => {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isAlreadyExitedError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ESRCH";

const assertValidPid = (pid: number, label: string): void => {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Cannot stop ${label}: invalid process pid ${pid}.`);
  }
};

export const signalProcessTree = (
  pid: number,
  signal: NodeJS.Signals,
  dependencies: SignalProcessTreeDependencies = {},
): void => {
  const platform = dependencies.platform ?? process.platform;
  const kill = dependencies.kill ?? process.kill;
  const spawnSyncCommand = dependencies.spawnSync ?? spawnSync;
  const isAlive = dependencies.isAlive ?? ((targetPid: number) => processIsAlive(targetPid, kill));

  if (platform === "win32") {
    const result = spawnSyncCommand("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    });
    if (result.status === 0 || !isAlive(pid)) {
      return;
    }
    throw new Error(`Failed to stop Windows process tree ${pid} with taskkill for ${signal}.`);
  }

  try {
    kill(-pid, signal);
  } catch (error) {
    if (isAlreadyExitedError(error)) {
      return;
    }
    if (!isAlive(pid)) {
      return;
    }
    throw error;
  }
};

export const terminateProcessTree = async ({
  pid,
  label,
  isClosed,
  waitForExit,
  stopTimeoutMs,
  signalDependencies,
}: TerminateProcessTreeInput): Promise<void> => {
  assertValidPid(pid, label);
  if (isClosed()) {
    return;
  }

  signalProcessTree(pid, "SIGTERM", signalDependencies);
  if (isClosed() || (await waitForExit(stopTimeoutMs))) {
    return;
  }

  signalProcessTree(pid, "SIGKILL", signalDependencies);
  if (isClosed() || (await waitForExit(stopTimeoutMs))) {
    return;
  }

  throw new Error(
    `Timed out waiting ${stopTimeoutMs}ms for ${label} process tree ${pid} to stop after SIGTERM and SIGKILL.`,
  );
};

export const shouldStartDetachedProcessGroup = (
  platform: ProcessTreePlatform = process.platform,
): boolean => platform !== "win32";
