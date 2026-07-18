import { Effect } from "effect";
import {
  type KillProcess,
  processTreeHasChildren,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "./process-tree";

const noopKill: KillProcess = () => true;
const noopProcessCommand = () =>
  Effect.succeed({
    status: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  });
const processIsAlive = () => true;

describe("process-tree", () => {
  test("detects a Unix child process from the parent-process table", async () => {
    const hasChildren = await Effect.runPromise(
      processTreeHasChildren(1234, {
        platform: "darwin",
        runCommand: () =>
          Effect.succeed({
            status: 0,
            stderr: Buffer.alloc(0),
            stdout: Buffer.from("   1\n1234\n  77\n"),
          }),
      }),
    );

    expect(hasChildren).toBe(true);
  });

  test("reports an idle Unix process when no child uses its pid", async () => {
    const hasChildren = await Effect.runPromise(
      processTreeHasChildren(1234, {
        platform: "linux",
        runCommand: () =>
          Effect.succeed({
            status: 0,
            stderr: Buffer.alloc(0),
            stdout: Buffer.from("   1\n  42\n  77\n"),
          }),
      }),
    );

    expect(hasChildren).toBe(false);
  });

  test("does not block the event loop while child processes are inspected", async () => {
    let eventLoopProgressed = false;
    const progress = new Promise<void>((resolve) => {
      setTimeout(() => {
        eventLoopProgressed = true;
        resolve();
      }, 0);
    });

    await Effect.runPromise(
      processTreeHasChildren(1234, {
        platform: "darwin",
        runCommand: () =>
          Effect.promise(async () => {
            await Bun.sleep(25);
            return { status: 0, stderr: Buffer.alloc(0), stdout: Buffer.from("1234\n") };
          }),
      }),
    );

    expect(eventLoopProgressed).toBe(true);
    await progress;
  });

  test("uses one direct Windows process query", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const hasChildren = await Effect.runPromise(
      processTreeHasChildren(1234, {
        platform: "win32",
        runCommand: (command, args) => {
          calls.push({ command, args });
          return Effect.succeed({
            status: 0,
            stderr: Buffer.alloc(0),
            stdout: Buffer.from("4321\r\n"),
          });
        },
      }),
    );

    expect(hasChildren).toBe(true);
    expect(calls).toEqual([
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(Get-CimInstance Win32_Process -Filter 'ParentProcessId = 1234' | Select-Object -First 1 -ExpandProperty ProcessId)",
        ],
      },
    ]);
  });

  test("selects taskkill for Windows process trees without negative pids", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await Effect.runPromise(
      terminateProcessTree({
        pid: 1234,
        label: "windows runtime",
        isClosed: () => false,
        waitForExit: () => Effect.succeed(true),
        stopTimeoutMs: 10,
        signalDependencies: {
          platform: "win32",
          kill: noopKill,
          runCommand: (command, args) => {
            calls.push({ command, args });
            return noopProcessCommand();
          },
          isAlive: processIsAlive,
        },
      }),
    );

    expect(calls).toEqual([
      {
        command: "taskkill",
        args: ["/pid", "1234", "/t", "/f"],
      },
    ]);
    expect(calls.at(0)?.args).not.toContain("-1234");
  });

  test("selects detached startup and negative process group signals on Unix-like platforms", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    expect(shouldStartDetachedProcessGroup("linux")).toBe(true);
    expect(shouldStartDetachedProcessGroup("darwin")).toBe(true);
    expect(shouldStartDetachedProcessGroup("win32")).toBe(false);

    await Effect.runPromise(
      terminateProcessTree({
        pid: 1234,
        label: "test runtime",
        isClosed: () => false,
        waitForExit: () => Effect.succeed(signals.length >= 2),
        stopTimeoutMs: 10,
        signalDependencies: {
          platform: "linux",
          kill: (pid, signal) => {
            if (signal === undefined || signal === 0) {
              throw new Error("Expected a process signal.");
            }
            signals.push({ pid, signal });
            return true;
          },
          runCommand: noopProcessCommand,
          isAlive: processIsAlive,
        },
      }),
    );

    expect(signals).toEqual([
      { pid: -1234, signal: "SIGTERM" },
      { pid: -1234, signal: "SIGKILL" },
    ]);
  });

  test("accepts already-closed process trees without signaling", async () => {
    const signals: unknown[] = [];

    await Effect.runPromise(
      terminateProcessTree({
        pid: 1234,
        label: "already closed",
        isClosed: () => true,
        waitForExit: () => Effect.dieMessage("wait should not be called"),
        stopTimeoutMs: 10,
        signalDependencies: {
          platform: "linux",
          kill: (pid, signal) => {
            signals.push({ pid, signal });
            return true;
          },
          runCommand: noopProcessCommand,
          isAlive: processIsAlive,
        },
      }),
    );

    expect(signals).toEqual([]);
  });

  test("throws an actionable error when the target remains alive after force cleanup", async () => {
    await expect(
      Effect.runPromise(
        terminateProcessTree({
          pid: 4321,
          label: "stubborn child",
          isClosed: () => false,
          waitForExit: () => Effect.succeed(false),
          stopTimeoutMs: 5,
          signalDependencies: {
            platform: "linux",
            kill: noopKill,
            runCommand: noopProcessCommand,
            isAlive: processIsAlive,
          },
        }),
      ),
    ).rejects.toThrow(
      "Timed out waiting 5ms per signal for stubborn child process tree 4321 to stop after SIGTERM and SIGKILL.",
    );
  });

  test("treats already-exited Unix process groups as cleaned up", async () => {
    const error = Object.assign(new Error("missing process"), { code: "ESRCH" });

    await expect(
      Effect.runPromise(
        terminateProcessTree({
          pid: 1234,
          label: "already exited",
          isClosed: () => false,
          waitForExit: () => Effect.succeed(true),
          stopTimeoutMs: 10,
          signalDependencies: {
            platform: "linux",
            kill: () => {
              throw error;
            },
            runCommand: noopProcessCommand,
            isAlive: () => false,
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("observes child close and removes its listener", async () => {
    const closeListeners: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const child = {
      once: (_event: "close", listener: () => void) => {
        closeListeners.push(listener);
        return child;
      },
      off: (_event: "close", listener: () => void) => {
        removed.push(listener);
        return child;
      },
    } as unknown as Parameters<typeof waitForChildProcessClose>[0];
    let closed = false;
    const waiting = Effect.runPromise(waitForChildProcessClose(child, () => closed, 100));

    await Promise.resolve();
    const closeListener = closeListeners[0];
    if (!closeListener) throw new Error("Expected a child close listener.");
    closed = true;
    closeListener();

    await expect(waiting).resolves.toBe(true);
    expect(removed).toEqual([closeListener]);
  });
});
