import { describe, expect, test } from "bun:test";
import {
  assertTerminalPtyConformance,
  observeLiveTerminalPtyConformance,
  terminateProcessTree,
  verifyLiveTerminalPtyInterrupt,
  verifyLiveTerminalPtyNaturalExitCleanup,
  verifyLiveTerminalPtyProcessTreeTermination,
} from "@openducktor/host";
import { Effect } from "effect";
import { type BunPtySpawn, type BunPtySpawnOptions, createBunPtyPort } from "./bun-pty-adapter";

const injectedCleanupFailure = () =>
  terminateProcessTree({
    pid: 0,
    label: "injected terminal cleanup",
    isClosed: () => false,
    waitForExit: () => Effect.succeed(false),
    stopTimeoutMs: 0,
  });

describe("createBunPtyPort", () => {
  test("satisfies the shared contract with a real Bun terminal process", async () => {
    if (process.platform === "win32" || typeof Bun.Terminal !== "function") return;
    const observation = await observeLiveTerminalPtyConformance(createBunPtyPort());
    expect(observation.transcript).toContain("INPUT:terminal-conformance");
    expect(observation.transcript).toMatch(/40\s+120/);
    expect(observation.eventOrder.at(-1)).toBe("exit");
    expect(observation.exit.exitCode).toBe(0);
  }, 7_000);
  test("terminates a real Bun PTY descendant process tree", async () => {
    if (process.platform === "win32" || typeof Bun.Terminal !== "function") return;
    const childPid = await verifyLiveTerminalPtyProcessTreeTermination(createBunPtyPort());
    expect(childPid).toBeGreaterThan(0);
  }, 7_000);
  test("cleans a real Bun PTY descendant after natural shell exit", async () => {
    if (process.platform === "win32" || typeof Bun.Terminal !== "function") return;
    const childPid = await verifyLiveTerminalPtyNaturalExitCleanup(createBunPtyPort());
    expect(childPid).toBeGreaterThan(0);
  }, 7_000);
  test("interrupts a real Bun PTY foreground process with Ctrl+C input", async () => {
    if (process.platform === "win32" || typeof Bun.Terminal !== "function") return;
    const exit = await verifyLiveTerminalPtyInterrupt(createBunPtyPort());
    expect(exit.exitCode).toBe(130);
  }, 7_000);
  test("reports no output pause and orders process exit after terminal EOF", async () => {
    const calls: string[] = [];
    const captured: { options: BunPtySpawnOptions | null } = { options: null };
    const terminal = {
      closed: false,
      write: (data: Uint8Array) => {
        calls.push(`write:${data.byteLength}`);
        return data.byteLength;
      },
      resize: (columns: number, rows: number) => calls.push(`resize:${columns}x${rows}`),
      close: () => {
        calls.push("close");
        const options = captured.options;
        if (options) options.terminal.exit(terminal, 0, null);
      },
    };
    const port = createBunPtyPort({
      platform: "win32",
      processTreeInspector: (pid) =>
        Effect.sync(() => {
          calls.push(`inspect-tree:${pid}`);
          return false;
        }),
      processTreeTerminator: (input) =>
        Effect.sync(() => {
          if (input.isClosed()) return;
          calls.push(`terminate-tree:${input.pid}`);
          const currentOptions = captured.options;
          if (!currentOptions) throw new Error("Expected Bun spawn options before termination.");
          currentOptions.onExit({ pid: 42, terminal, kill: () => undefined }, 0, 15);
          currentOptions.terminal.exit(terminal, 0, null);
        }),
      spawn: ((_command, value) => {
        captured.options = value;
        return { pid: 42, terminal, kill: () => calls.push("kill") };
      }) satisfies BunPtySpawn,
    });
    const exits: unknown[] = [];
    const output: number[][] = [];
    const eventOrder: string[] = [];
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: ["-l"], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        {
          onOutput: (data) => {
            output.push([...data]);
            eventOrder.push("output");
          },
          onFailure: () => undefined,
          onExit: (exit) => {
            exits.push(exit);
            eventOrder.push("exit");
          },
        },
      ),
    );
    expect(handle.supportsOutputPause).toBe(false);
    expect(await Effect.runPromise(handle.hasChildProcesses())).toBe(false);
    expect(calls).toContain("inspect-tree:42");
    const options = captured.options;
    if (!options) throw new Error("Expected Bun spawn options to be captured.");
    options.terminal.data(terminal, new Uint8Array([1, 2]));
    await Effect.runPromise(handle.write(new Uint8Array([65])));
    await Effect.runPromise(handle.resize({ columns: 120, rows: 40 }));
    options.onExit({ pid: 42, terminal, kill: () => undefined }, 7, null);
    expect(exits).toEqual([]);
    options.terminal.exit(terminal, 0, null);
    await Bun.sleep(0);
    expect(exits).toEqual([{ exitCode: 7, signal: null }]);
    assertTerminalPtyConformance({
      output,
      eventOrder,
      operations: calls,
      supportsOutputPause: handle.supportsOutputPause,
      expectedOutputPause: false,
    });
    await Effect.runPromise(handle.terminate());
    expect(calls.at(-1)).toBe("close");
    expect(calls).not.toContain("terminate-tree:42");
  });

  test("resumes a partial input write after terminal drain", async () => {
    const captured: { options: BunPtySpawnOptions | null } = { options: null };
    const writes: number[][] = [];
    let writeCalls = 0;
    const terminal = {
      closed: false,
      write: (data: Uint8Array) => {
        writes.push([...data]);
        writeCalls += 1;
        return writeCalls === 1 ? 1 : data.byteLength;
      },
      resize: () => undefined,
      close: () => undefined,
    };
    const port = createBunPtyPort({
      platform: "win32",
      spawn: ((_command, options) => {
        captured.options = options;
        return { pid: 42, terminal, kill: () => undefined };
      }) satisfies BunPtySpawn,
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: ["-l"], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );

    const writing = Effect.runPromise(handle.write(new Uint8Array([1, 2, 3])));
    await Bun.sleep(0);
    expect(writes).toEqual([[1, 2, 3]]);
    const options = captured.options;
    if (!options) throw new Error("Expected Bun spawn options to be captured.");
    options.terminal.drain(terminal);

    await expect(writing).resolves.toBeUndefined();
    expect(writes).toEqual([
      [1, 2, 3],
      [2, 3],
    ]);
  });

  test("retries process-tree cleanup after a failed termination", async () => {
    const captured: { options: BunPtySpawnOptions | null } = { options: null };
    let cleanupCalls = 0;
    let terminalCloseCalls = 0;
    let terminalClosed = false;
    const terminal = {
      get closed() {
        return terminalClosed;
      },
      write: (data: Uint8Array) => data.byteLength,
      resize: () => undefined,
      close: () => {
        terminalCloseCalls += 1;
        terminalClosed = true;
        captured.options?.terminal.exit(terminal, 0, null);
      },
    };
    const port = createBunPtyPort({
      platform: "win32",
      processTreeTerminator: () => {
        cleanupCalls += 1;
        return cleanupCalls === 1 ? injectedCleanupFailure() : Effect.void;
      },
      spawn: ((_command, options) => {
        captured.options = options;
        return { pid: 42, terminal, kill: () => undefined };
      }) satisfies BunPtySpawn,
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: ["-l"], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );

    await expect(Effect.runPromise(handle.terminate())).rejects.toThrow(
      "Bun terminal process-tree termination failed.",
    );
    await Effect.runPromise(handle.terminate());

    expect(cleanupCalls).toBe(2);
    expect(terminalCloseCalls).toBe(1);
  });

  test("publishes one convergent natural-finalization failure and allows explicit retry", async () => {
    const captured: { options: BunPtySpawnOptions | null } = { options: null };
    const failures: string[] = [];
    let reportFailure: (() => void) | null = null;
    const failureReported = new Promise<void>((resolve) => {
      reportFailure = resolve;
    });
    const exits: unknown[] = [];
    let cleanupCalls = 0;
    let terminalCloseCalls = 0;
    let terminalClosed = false;
    const terminal = {
      get closed() {
        return terminalClosed;
      },
      write: (data: Uint8Array) => data.byteLength,
      resize: () => undefined,
      close: () => {
        terminalCloseCalls += 1;
        terminalClosed = true;
        captured.options?.terminal.exit(terminal, 0, null);
      },
    };
    const port = createBunPtyPort({
      platform: "win32",
      processTreeTerminator: () => {
        cleanupCalls += 1;
        return cleanupCalls === 1 ? injectedCleanupFailure() : Effect.void;
      },
      spawn: ((_command, options) => {
        captured.options = options;
        return { pid: 42, terminal, kill: () => undefined };
      }) satisfies BunPtySpawn,
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: ["-l"], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        {
          onOutput: () => undefined,
          onFailure: (failure) => {
            failures.push(failure.message);
            reportFailure?.();
          },
          onExit: (exit) => exits.push(exit),
        },
      ),
    );
    const options = captured.options;
    if (!options) throw new Error("Expected Bun spawn options to be captured.");

    options.onExit({ pid: 42, terminal, kill: () => undefined }, 0, null);
    await failureReported;
    await Bun.sleep(0);

    options.terminal.exit(terminal, 0, null);
    await Bun.sleep(0);
    expect(failures).toEqual(["Bun terminal process-tree termination failed."]);
    expect(cleanupCalls).toBe(1);
    expect(exits).toEqual([]);

    await Effect.runPromise(handle.terminate());

    expect(cleanupCalls).toBe(2);
    expect(terminalCloseCalls).toBe(1);
    expect(exits).toEqual([{ exitCode: 0, signal: null }]);
  });

  test("does not report success after EOF timeout when Bun already marks the terminal closed", async () => {
    const captured: { options: BunPtySpawnOptions | null } = { options: null };
    let cleanupCalls = 0;
    let terminalCloseCalls = 0;
    let terminalClosed = false;
    const terminal = {
      get closed() {
        return terminalClosed;
      },
      write: (data: Uint8Array) => data.byteLength,
      resize: () => undefined,
      close: () => {
        terminalCloseCalls += 1;
        terminalClosed = true;
      },
    };
    const port = createBunPtyPort({
      platform: "win32",
      processTreeTerminator: () => {
        cleanupCalls += 1;
        return Effect.void;
      },
      spawn: ((_command, options) => {
        captured.options = options;
        return { pid: 42, terminal, kill: () => undefined };
      }) satisfies BunPtySpawn,
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: ["-l"], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );

    await expect(Effect.runPromise(handle.terminate())).rejects.toThrow(
      "Bun terminal did not publish EOF after process-tree termination.",
    );
    expect(cleanupCalls).toBe(1);
    expect(terminalCloseCalls).toBe(1);

    captured.options?.terminal.exit(terminal, 0, null);
    await Effect.runPromise(handle.terminate());
    expect(cleanupCalls).toBe(1);
    expect(terminalCloseCalls).toBe(1);
  }, 2_000);
});
