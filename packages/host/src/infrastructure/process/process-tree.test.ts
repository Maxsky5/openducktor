import { Effect } from "effect";
import {
  type KillProcess,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
} from "./process-tree";

const noopKill: KillProcess = () => true;
const noopSpawnSync = () => ({
  status: 0,
  signal: null,
  output: [],
  pid: 0,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
});
const processIsAlive = () => true;

describe("process-tree", () => {
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
          spawnSync: (command, args) => {
            calls.push({ command, args });
            return noopSpawnSync();
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
          spawnSync: noopSpawnSync,
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
          spawnSync: noopSpawnSync,
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
            spawnSync: noopSpawnSync,
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
            spawnSync: noopSpawnSync,
            isAlive: () => false,
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
