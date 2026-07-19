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

type ProcessTreeSignalTargets = {
  pid: number;
  platform: ProcessTreePlatform;
  processGroupIds: number[];
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

const inspectProcessTreeSignalTargets = (
  pid: number,
  dependencies: SignalProcessTreeDependencies,
): Effect.Effect<ProcessTreeSignalTargets, HostOperationError> =>
  Effect.gen(function* () {
    if (dependencies.platform === "win32") {
      return { pid, platform: dependencies.platform, processGroupIds: [] };
    }

    const result = yield* dependencies.runCommand("ps", ["-Ao", "pid=,ppid=,pgid="]);
    if (result.error || result.status !== 0) {
      return yield* Effect.fail(
        new HostOperationError({
          message: `Failed to inspect Unix process groups for process ${pid}.`,
          operation: "process-tree.stop",
          details: {
            pid,
            platform: dependencies.platform,
            status: result.status,
            stderr: result.stderr.toString("utf8").trim(),
          },
          ...(result.error ? { cause: result.error } : {}),
        }),
      );
    }

    const processes = result.stdout
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(
        (entry): entry is [number, number, number] =>
          entry.length === 3 && entry.every((value) => Number.isInteger(value) && value >= 0),
      );
    const childrenByParent = new Map<number, Array<[number, number]>>();
    let rootProcessGroupId = pid;
    for (const [processId, parentProcessId, processGroupId] of processes) {
      if (processId === pid && processGroupId > 0) rootProcessGroupId = processGroupId;
      const children = childrenByParent.get(parentProcessId) ?? [];
      children.push([processId, processGroupId]);
      childrenByParent.set(parentProcessId, children);
    }

    const descendants = [...(childrenByParent.get(pid) ?? [])];
    const descendantGroupIds = new Set<number>();
    for (let index = 0; index < descendants.length; index += 1) {
      const [processId, processGroupId] = descendants[index] ?? [];
      if (processId === undefined || processGroupId === undefined) continue;
      if (processGroupId > 0 && processGroupId !== rootProcessGroupId) {
        descendantGroupIds.add(processGroupId);
      }
      descendants.push(...(childrenByParent.get(processId) ?? []));
    }

    return {
      pid,
      platform: dependencies.platform,
      processGroupIds: [...descendantGroupIds, rootProcessGroupId],
    };
  });

const signalProcessTree = (
  targets: ProcessTreeSignalTargets,
  signal: NodeJS.Signals,
  dependencies: SignalProcessTreeDependencies = defaultSignalProcessTreeDependencies(),
): Effect.Effect<void, HostOperationError> =>
  Effect.gen(function* () {
    const { pid, processGroupIds } = targets;
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

    for (const processGroupId of processGroupIds) {
      yield* Effect.try({
        try: () => {
          try {
            kill(-processGroupId, signal);
          } catch (error) {
            if (isAlreadyExitedError(error) || !isAlive(-processGroupId)) return;
            throw error;
          }
        },
        catch: (cause) =>
          toHostOperationError(cause, "process-tree.signal", { pid, processGroupId, signal }),
      });
    }
  });

const signalProcessTreeEffect = (
  targets: ProcessTreeSignalTargets,
  signal: NodeJS.Signals,
  dependencies: SignalProcessTreeDependencies,
) =>
  signalProcessTree(targets, signal, dependencies).pipe(
    Effect.mapError((cause) =>
      toHostOperationError(cause, "process-tree.signal", { pid: targets.pid, signal }),
    ),
  );

const signalTargetsAreClosed = (
  targets: ProcessTreeSignalTargets,
  dependencies: SignalProcessTreeDependencies,
): boolean => {
  if (targets.platform === "win32") return !dependencies.isAlive(targets.pid);
  return targets.processGroupIds.every((processGroupId) => !dependencies.isAlive(-processGroupId));
};

const waitForSignalTargetsExit = (
  targets: ProcessTreeSignalTargets,
  dependencies: SignalProcessTreeDependencies,
  timeoutMs: number,
): Effect.Effect<boolean> => {
  if (signalTargetsAreClosed(targets, dependencies)) return Effect.succeed(true);
  return Effect.async<boolean>((resume, signal) => {
    const deadline = Date.now() + timeoutMs;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (closed: boolean): void => {
      if (timeout) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resume(Effect.succeed(closed));
    };
    const check = (): void => {
      if (signalTargetsAreClosed(targets, dependencies)) {
        finish(true);
        return;
      }
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      timeout = setTimeout(check, Math.min(10, Math.max(1, deadline - Date.now())));
    };
    const onAbort = (): void => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
    check();
    return Effect.sync(() => {
      if (timeout) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    });
  });
};

const waitForProcessTreeExit = (
  targets: ProcessTreeSignalTargets,
  dependencies: SignalProcessTreeDependencies,
  waitForExit: TerminateProcessTreeInput["waitForExit"],
  timeoutMs: number,
): Effect.Effect<boolean, HostOperationError> =>
  Effect.all([waitForExit(timeoutMs), waitForSignalTargetsExit(targets, dependencies, timeoutMs)], {
    concurrency: "unbounded",
  }).pipe(Effect.map(([ownerClosed, targetsClosed]) => ownerClosed && targetsClosed));

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

    const dependencies = signalDependencies ?? defaultSignalProcessTreeDependencies();
    const targets = yield* inspectProcessTreeSignalTargets(pid, dependencies);

    yield* signalProcessTreeEffect(targets, "SIGTERM", dependencies);
    if (yield* waitForProcessTreeExit(targets, dependencies, waitForExit, stopTimeoutMs)) {
      return;
    }

    yield* signalProcessTreeEffect(targets, "SIGKILL", dependencies);
    if (yield* waitForProcessTreeExit(targets, dependencies, waitForExit, stopTimeoutMs)) {
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
