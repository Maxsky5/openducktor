import {
  type ChildProcess,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
  spawnSync,
} from "node:child_process";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";

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
  waitForExit: (timeoutMs: number) => Effect.Effect<boolean, HostOperationError>;
  stopTimeoutMs: number;
  signalDependencies?: SignalProcessTreeDependencies;
};

export type ProcessTreeTerminator = (
  input: TerminateProcessTreeInput,
) => Effect.Effect<void, HostOperationError>;

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
    throw new HostOperationError({
      message: `Cannot stop ${label}: invalid process pid ${pid}.`,
      operation: "process-tree.stop",
      details: { pid, label },
    });
  }
};

/** @internal Test-only seam for process-tree signaling strategy. */
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
    throw new HostOperationError({
      message: `Failed to stop Windows process tree ${pid} with taskkill for ${signal}.`,
      operation: "process-tree.stop",
      details: { pid, signal },
    });
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

const signalProcessTreeEffect = (
  pid: number,
  signal: NodeJS.Signals,
  dependencies?: SignalProcessTreeDependencies,
) =>
  Effect.try({
    try: () => signalProcessTree(pid, signal, dependencies),
    catch: (cause) => toHostOperationError(cause, "process-tree.signal", { pid, signal }),
  });

export const terminateProcessTree = ({
  pid,
  label,
  isClosed,
  waitForExit,
  stopTimeoutMs,
  signalDependencies,
}: TerminateProcessTreeInput): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertValidPid(pid, label),
      catch: (cause) => toHostOperationError(cause, "process-tree.stop", { pid, label }),
    });
    if (isClosed()) {
      return;
    }

    yield* signalProcessTreeEffect(pid, "SIGTERM", signalDependencies);
    if (isClosed() || (yield* waitForExit(stopTimeoutMs))) {
      return;
    }

    yield* signalProcessTreeEffect(pid, "SIGKILL", signalDependencies);
    if (isClosed() || (yield* waitForExit(stopTimeoutMs))) {
      return;
    }

    return yield* Effect.fail(
      new HostOperationError({
        message: `Timed out waiting ${stopTimeoutMs}ms per signal for ${label} process tree ${pid} to stop after SIGTERM and SIGKILL.`,
        operation: "process-tree.stop",
        details: { pid, label, stopTimeoutMs },
      }),
    );
  });

export const waitForChildProcessClose = (
  child: Pick<ChildProcess, "once" | "off">,
  isClosed: () => boolean,
  timeoutMs: number,
): Effect.Effect<boolean> => {
  if (isClosed()) {
    return Effect.succeed(true);
  }

  return Effect.async<boolean>((resume, signal) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      child.off("close", onClose);
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resume(Effect.succeed(closed));
    };
    const onClose = () => finish(true);
    const onAbort = () => finish(false);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("close", onClose);
    if (isClosed()) {
      finish(true);
    }
  });
};

export const shouldStartDetachedProcessGroup = (
  platform: ProcessTreePlatform = process.platform,
): boolean => platform !== "win32";
