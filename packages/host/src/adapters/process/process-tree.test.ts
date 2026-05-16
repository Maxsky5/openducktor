import {
  shouldStartDetachedProcessGroup,
  signalProcessTree,
  terminateProcessTree,
} from "./process-tree";

describe("process-tree", () => {
  test("selects taskkill for Windows process trees without negative pids", () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    signalProcessTree(1234, "SIGTERM", {
      platform: "win32",
      spawnSync: ((command, args) => {
        calls.push({ command, args: args as string[] });
        return { status: 0 };
      }) as typeof import("node:child_process").spawnSync,
      isAlive: () => true,
    });

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

    await terminateProcessTree({
      pid: 1234,
      label: "test runtime",
      isClosed: () => false,
      waitForExit: async () => signals.length >= 2,
      stopTimeoutMs: 10,
      signalDependencies: {
        platform: "linux",
        kill: ((pid, signal) => {
          if (signal === undefined) {
            throw new Error("Expected a process signal.");
          }
          signals.push({ pid, signal: signal as NodeJS.Signals });
          return true;
        }) as typeof process.kill,
        isAlive: () => true,
      },
    });

    expect(signals).toEqual([
      { pid: -1234, signal: "SIGTERM" },
      { pid: -1234, signal: "SIGKILL" },
    ]);
  });

  test("accepts already-closed process trees without signaling", async () => {
    const signals: unknown[] = [];

    await terminateProcessTree({
      pid: 1234,
      label: "already closed",
      isClosed: () => true,
      waitForExit: async () => {
        throw new Error("wait should not be called");
      },
      stopTimeoutMs: 10,
      signalDependencies: {
        kill: ((pid, signal) => {
          signals.push({ pid, signal });
          return true;
        }) as typeof process.kill,
      },
    });

    expect(signals).toEqual([]);
  });

  test("throws an actionable error when the target remains alive after force cleanup", async () => {
    await expect(
      terminateProcessTree({
        pid: 4321,
        label: "stubborn child",
        isClosed: () => false,
        waitForExit: async () => false,
        stopTimeoutMs: 5,
        signalDependencies: {
          platform: "linux",
          kill: (() => true) as typeof process.kill,
          isAlive: () => true,
        },
      }),
    ).rejects.toThrow(
      "Timed out waiting 5ms for stubborn child process tree 4321 to stop after SIGTERM and SIGKILL.",
    );
  });

  test("treats already-exited Unix process groups as cleaned up", () => {
    const error = Object.assign(new Error("missing process"), { code: "ESRCH" });

    expect(() =>
      signalProcessTree(1234, "SIGTERM", {
        platform: "linux",
        kill: (() => {
          throw error;
        }) as typeof process.kill,
        isAlive: () => false,
      }),
    ).not.toThrow();
  });
});
