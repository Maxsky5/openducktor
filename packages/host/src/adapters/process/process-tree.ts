import {
  type ChildProcess,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
  spawnSync,
} from "node:child_process";

export type ProcessTreePlatform = NodeJS.Platform;
export type KillProcess = (pid: number, signal?: NodeJS.Signals | 0) => boolean;
type SpawnSyncCommand = (
  command: string,
  args: string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

type SignalProcessTreeDependencies = {
  platform: ProcessTreePlatform;
  kill: KillProcess;
  spawnSync: SpawnSyncCommand;
  isAlive: (pid: number) => boolean;
};

export type TerminateProcessTreeInput = {
  pid: number;
  label: string;
  isClosed: () => boolean;
  waitForExit: (timeoutMs: number) => Promise<boolean>;
  stopTimeoutMs: number;
  signalDependencies?: SignalProcessTreeDependencies;
};

export type ProcessTreeTerminator = (input: TerminateProcessTreeInput) => Promise<void>;

const defaultSignalProcessTreeDependencies = (): SignalProcessTreeDependencies => {
  const kill: KillProcess = process.kill;
  return {
    platform: process.platform,
    kill,
    spawnSync,
    isAlive: (pid) => processIsAlive(pid, kill),
  };
};

export const processIsAlive = (pid: number, kill: KillProcess = process.kill): boolean => {
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
  dependencies: SignalProcessTreeDependencies = defaultSignalProcessTreeDependencies(),
): void => {
  const { platform, kill, spawnSync: spawnSyncCommand, isAlive } = dependencies;

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
    `Timed out waiting ${stopTimeoutMs}ms per signal for ${label} process tree ${pid} to stop after SIGTERM and SIGKILL.`,
  );
};

export const waitForChildProcessClose = (
  child: Pick<ChildProcess, "once" | "off">,
  isClosed: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  if (isClosed()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    child.once("close", onClose);
    if (isClosed()) {
      child.off("close", onClose);
      clearTimeout(timeout);
      resolve(true);
    }
  });
};

export const shouldStartDetachedProcessGroup = (
  platform: ProcessTreePlatform = process.platform,
): boolean => platform !== "win32";
