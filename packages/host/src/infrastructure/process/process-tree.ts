import { type ChildProcess, execFile } from "node:child_process";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";

export type ProcessTreePlatform = NodeJS.Platform;
export type KillProcess = (pid: number, signal?: NodeJS.Signals | 0) => boolean;
export type ProcessCommandResult = {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
};

export type ProcessCommandRunner = (
  command: string,
  args: string[],
) => Effect.Effect<ProcessCommandResult>;

export type InspectProcessTreeDependencies = {
  platform: ProcessTreePlatform;
  runCommand: ProcessCommandRunner;
};

export type ProcessTreeInspector = (pid: number) => Effect.Effect<boolean, HostOperationError>;

type SignalProcessTreeDependencies = {
  platform: ProcessTreePlatform;
  kill: KillProcess;
  runCommand: ProcessCommandRunner;
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

export type ObservedStateSubscription = (listener: () => void) => () => void;

export const waitForObservedState = ({
  isComplete,
  subscribe,
  timeoutMs,
}: {
  isComplete: () => boolean;
  subscribe: ObservedStateSubscription;
  timeoutMs: number;
}): Effect.Effect<boolean> => {
  if (isComplete()) return Effect.succeed(true);
  return Effect.async<boolean>((resume, signal) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resume(Effect.succeed(value));
    };
    const onObserved = () => {
      if (isComplete()) finish(true);
    };
    const onAbort = () => finish(false);
    const unsubscribe = subscribe(onObserved);
    const timeout = setTimeout(() => finish(isComplete()), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    onObserved();
  });
};

const defaultSignalProcessTreeDependencies = (): SignalProcessTreeDependencies => {
  const kill: KillProcess = process.kill;
  return {
    platform: process.platform,
    kill,
    runCommand: runProcessCommand,
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

export const processTreeIsAlive = (
  pid: number,
  platform: ProcessTreePlatform = process.platform,
  kill: KillProcess = process.kill,
): boolean => processIsAlive(platform === "win32" ? pid : -pid, kill);

const runProcessCommand: ProcessCommandRunner = (command, args) =>
  Effect.async<ProcessCommandResult>((resume, signal) => {
    const child = execFile(
      command,
      args,
      { encoding: "buffer", windowsHide: true },
      (error, stdout, stderr) => {
        const status =
          error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resume(
          Effect.succeed({
            status,
            stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
            stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
            ...(error ? { error } : {}),
          }),
        );
      },
    );
    const abort = (): void => {
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

export const processTreeHasChildren = (
  pid: number,
  dependencies: InspectProcessTreeDependencies = {
    platform: process.platform,
    runCommand: runProcessCommand,
  },
): Effect.Effect<boolean, HostOperationError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertValidPid(pid, "process tree"),
      catch: (cause) => toHostOperationError(cause, "process-tree.inspect", { pid }),
    });
    const { platform, runCommand } = dependencies;
    const result = yield* runCommand(
      platform === "win32" ? "powershell.exe" : "ps",
      platform === "win32"
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | Select-Object -First 1 -ExpandProperty ProcessId)`,
          ]
        : ["-Ao", "ppid="],
    );
    if (result.error || result.status !== 0) {
      return yield* Effect.fail(
        new HostOperationError({
          message: `Failed to inspect child processes for process ${pid}.`,
          operation: "process-tree.inspect",
          details: {
            pid,
            platform,
            status: result.status,
            stderr: result.stderr.toString("utf8").trim(),
          },
          ...(result.error ? { cause: result.error } : {}),
        }),
      );
    }
    if (platform === "win32") return result.stdout.toString("utf8").trim().length > 0;
    return result.stdout
      .toString("utf8")
      .split(/\s+/)
      .some((parentPid) => Number(parentPid) === pid);
  });

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
const signalProcessTree = (
  pid: number,
  signal: NodeJS.Signals,
  dependencies: SignalProcessTreeDependencies = defaultSignalProcessTreeDependencies(),
): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const { platform, kill, runCommand, isAlive } = dependencies;

    if (platform === "win32") {
      const result = yield* runCommand("taskkill", ["/pid", String(pid), "/t", "/f"]);
      if (result.status === 0 || !isAlive(pid)) {
        return;
      }
      throw new HostOperationError({
        message: `Failed to stop Windows process tree ${pid} with taskkill for ${signal}.`,
        operation: "process-tree.stop",
        details: { pid, signal },
      });
    }

    yield* Effect.try({
      try: () => {
        try {
          kill(-pid, signal);
        } catch (error) {
          if (isAlreadyExitedError(error) || !isAlive(pid)) return;
          throw error;
        }
      },
      catch: (cause) => toHostOperationError(cause, "process-tree.signal", { pid, signal }),
    });
  });

const signalProcessTreeEffect = (
  pid: number,
  signal: NodeJS.Signals,
  dependencies?: SignalProcessTreeDependencies,
) =>
  signalProcessTree(pid, signal, dependencies).pipe(
    Effect.mapError((cause) => toHostOperationError(cause, "process-tree.signal", { pid, signal })),
  );

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
): Effect.Effect<boolean> =>
  waitForObservedState({
    isComplete: isClosed,
    timeoutMs,
    subscribe: (listener) => {
      child.once("close", listener);
      return () => child.off("close", listener);
    },
  });

export const shouldStartDetachedProcessGroup = (
  platform: ProcessTreePlatform = process.platform,
): boolean => platform !== "win32";
