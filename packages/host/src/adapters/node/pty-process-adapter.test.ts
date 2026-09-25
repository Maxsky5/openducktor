import { describe, expect, test } from "bun:test";
import { assertTerminalPtyConformance } from "../../testing/terminal-pty-conformance";
import { Effect } from "effect";
import { createNodePtyPort } from "./pty-process-adapter";

describe("createNodePtyPort", () => {
  test("includes the native spawn error, shell, and directory in startup failures", async () => {
    const port = createNodePtyPort({
      nodePty: {
        spawn: () => {
          throw new Error("Access is denied");
        },
      },
    });
    const result = await Effect.runPromise(
      Effect.either(
        port.start(
          {
            shell: "C:\\Windows\\System32\\cmd.exe",
            args: [],
            cwd: "C:\\repo",
            env: {},
            grid: { columns: 80, rows: 24 },
          },
          { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.code).toBe("spawn_failed");
      expect(result.left.message).toContain("Access is denied");
      expect(result.left.message).toContain("C:\\Windows\\System32\\cmd.exe");
      expect(result.left.message).toContain("C:\\repo");
      expect(result.left.message).toContain("Check that");
    }
  });

  test.each([
    { exitCode: 0, signal: 0, requestedClose: false, failed: false },
    { exitCode: 1, signal: 0, requestedClose: false, failed: true },
    { exitCode: 0, signal: 15, requestedClose: false, failed: true },
    { exitCode: 0, signal: 15, requestedClose: true, failed: false },
    { exitCode: -1, signal: 0, requestedClose: false, failed: true, pid: 0 },
  ])(
    "classifies silent exit $exitCode, signal $signal, requested close $requestedClose",
    async ({ exitCode, signal, requestedClose, failed, pid = 42 }) => {
      let exitListener: (event: { exitCode: number; signal: number }) => void = () => undefined;
      const events: string[] = [];
      const terminatedPids: number[] = [];
      const port = createNodePtyPort({
        processTreeTerminator: ({ pid }) =>
          Effect.sync(() => {
            terminatedPids.push(pid);
          }),
        nodePty: {
          spawn: () => ({
            pid,
            onData: () => ({ dispose: () => undefined }),
            onExit: (listener) => {
              exitListener = listener;
              return { dispose: () => undefined };
            },
            write: () => undefined,
            resize: () => undefined,
            pause: () => undefined,
            resume: () => undefined,
          }),
        },
      });
      const handle = await Effect.runPromise(
        port.start(
          { shell: "cmd.exe", args: [], cwd: "C:\\repo", env: {}, grid: { columns: 80, rows: 24 } },
          {
            onOutput: () => undefined,
            onFailure: (failure) => events.push(failure.message),
            onExit: () => events.push("exit"),
          },
        ),
      );
      if (requestedClose) await Effect.runPromise(handle.terminate());
      exitListener({ exitCode, signal });
      await Bun.sleep(0);
      await Effect.runPromise(handle.terminate());
      expect(terminatedPids).toEqual(pid === 0 ? [] : [pid]);
      expect(events.at(-1)).toBe("exit");
      if (!failed) expect(events).toEqual(["exit"]);
      else {
        expect(events).toHaveLength(2);
        expect(events[0]).toContain(
          `cmd.exe exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""} before producing output in C:\\repo`,
        );
        expect(events[0]).toContain("outside OpenDucktor");
      }
    },
  );
  test("maps raw output, resize, pause, resume, input, exit, and cleanup", async () => {
    const calls: string[] = [];
    let dataListener: (data: string | Buffer) => void = () => undefined;
    let exitListener: (event: { exitCode: number; signal?: number }) => void = () => undefined;
    const disposable = () => ({ dispose: () => calls.push("dispose") });
    const port = createNodePtyPort({
      processTreeInspector: (pid) =>
        Effect.sync(() => {
          calls.push(`inspect-tree:${pid}`);
          return true;
        }),
      processTreeTerminator: (input) =>
        Effect.sync(() => {
          calls.push(`terminate-tree:${input.pid}`);
          exitListener({ exitCode: 0, signal: 15 });
        }),
      nodePty: {
        spawn: (_shell, _args, options) => {
          expect(options.encoding).toBeNull();
          return {
            pid: 42,
            onData: (listener: (data: string | Buffer) => void) => {
              dataListener = listener;
              return disposable();
            },
            onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
              exitListener = listener;
              return disposable();
            },
            write: (data: Buffer) => calls.push(`write:${data.toString()}`),
            resize: (columns: number, rows: number) => calls.push(`resize:${columns}x${rows}`),
            pause: () => calls.push("pause"),
            resume: () => calls.push("resume"),
          };
        },
      },
    });
    const output: number[][] = [];
    const exits: unknown[] = [];
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
    dataListener(Buffer.from([1, 2]));
    await Effect.runPromise(handle.write(new Uint8Array([65])));
    await Effect.runPromise(handle.resize({ columns: 120, rows: 40 }));
    await Effect.runPromise(handle.pauseOutput());
    await Effect.runPromise(handle.resumeOutput());
    expect(await Effect.runPromise(handle.hasChildProcesses())).toBe(true);
    await Effect.runPromise(handle.terminate());
    expect(output).toEqual([[1, 2]]);
    expect(exits).toEqual([{ exitCode: 0, signal: "15" }]);
    expect(calls).toContain("write:A");
    expect(calls).toContain("resize:120x40");
    expect(calls).toContain("pause");
    expect(calls).toContain("resume");
    expect(calls).toContain("inspect-tree:42");
    assertTerminalPtyConformance({
      output,
      eventOrder,
      operations: calls,
      supportsOutputPause: handle.supportsOutputPause,
      expectedOutputPause: true,
    });
    expect(calls).toContain("terminate-tree:42");
  });

  test("resumes a paused PTY before waiting for process-tree termination", async () => {
    const calls: string[] = [];
    let paused = false;
    let exitListener: (event: { exitCode: number; signal: number }) => void = () => undefined;
    const terminationStarted = Promise.withResolvers<void>();
    const finishTermination = Promise.withResolvers<void>();
    const port = createNodePtyPort({
      processTreeTerminator: () =>
        Effect.promise(async () => {
          calls.push(paused ? "terminate-while-paused" : "terminate-after-resume");
          terminationStarted.resolve();
          await finishTermination.promise;
          exitListener({ exitCode: 0, signal: 15 });
        }),
      nodePty: {
        spawn: () => ({
          pid: 42,
          onData: () => ({ dispose: () => undefined }),
          onExit: (listener) => {
            exitListener = listener;
            return { dispose: () => undefined };
          },
          write: () => undefined,
          resize: () => undefined,
          pause: () => {
            paused = true;
            calls.push("pause");
          },
          resume: () => {
            paused = false;
            calls.push("resume");
          },
        }),
      },
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );

    await Effect.runPromise(handle.pauseOutput());
    const termination = Effect.runPromise(handle.terminate());
    await terminationStarted.promise;
    await Effect.runPromise(handle.pauseOutput());
    finishTermination.resolve();
    await termination;

    expect(calls).toEqual(["pause", "resume", "terminate-after-resume"]);
  });

  test("shares one process-tree close for concurrent terminate requests", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let closeCount = 0;
    let resumeCount = 0;
    const port = createNodePtyPort({
      processTreeTerminator: () =>
        Effect.promise(async () => {
          closeCount += 1;
          started.resolve();
          await finish.promise;
        }),
      nodePty: {
        spawn: () => ({
          pid: 42,
          onData: () => ({ dispose: () => undefined }),
          onExit: () => ({ dispose: () => undefined }),
          write: () => undefined,
          resize: () => undefined,
          pause: () => undefined,
          resume: () => {
            resumeCount += 1;
          },
        }),
      },
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );
    const first = Effect.runPromise(handle.terminate());
    await started.promise;
    const second = Effect.runPromise(handle.terminate());
    finish.resolve();
    await Promise.all([first, second]);
    await Effect.runPromise(handle.terminate());
    expect(closeCount).toBe(1);
    expect(resumeCount).toBe(1);
  });

  test("rejects PTY input during termination and allows it after a failed close", async () => {
    const ioCalls: string[] = [];
    const terminationStarted = Promise.withResolvers<void>();
    const finishTermination = Promise.withResolvers<void>();
    let attempts = 0;
    const port = createNodePtyPort({
      processTreeTerminator: () =>
        Effect.promise(async () => {
          attempts += 1;
          if (attempts === 1) {
            terminationStarted.resolve();
            await finishTermination.promise;
            throw new Error("process tree stayed live");
          }
        }),
      nodePty: {
        spawn: () => ({
          pid: 42,
          onData: () => ({ dispose: () => undefined }),
          onExit: () => ({ dispose: () => undefined }),
          write: () => ioCalls.push("write"),
          resize: () => ioCalls.push("resize"),
          pause: () => undefined,
          resume: () => undefined,
        }),
      },
    });
    const handle = await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        { onOutput: () => undefined, onFailure: () => undefined, onExit: () => undefined },
      ),
    );
    const write = () => Effect.runPromise(Effect.either(handle.write(new Uint8Array([65]))));
    const resize = () =>
      Effect.runPromise(Effect.either(handle.resize({ columns: 120, rows: 40 })));

    const termination = Effect.runPromise(handle.terminate());
    await terminationStarted.promise;
    const duringClose = await Promise.all([write(), resize()]);
    expect(duringClose.map((result) => result._tag)).toEqual(["Left", "Left"]);
    expect(duringClose.map((result) => result._tag === "Left" && result.left.message)).toEqual([
      "Terminal is closing. Wait for close to finish or retry if it fails.",
      "Terminal is closing. Wait for close to finish or retry if it fails.",
    ]);
    expect(ioCalls).toEqual([]);

    finishTermination.resolve();
    await expect(termination).rejects.toThrow("node-pty process-tree termination failed");
    expect((await Promise.all([write(), resize()])).map((result) => result._tag)).toEqual([
      "Right",
      "Right",
    ]);
    expect(ioCalls).toEqual(["write", "resize"]);

    await Effect.runPromise(handle.terminate());
    expect((await Promise.all([write(), resize()])).map((result) => result._tag)).toEqual([
      "Left",
      "Left",
    ]);
    expect(ioCalls).toEqual(["write", "resize"]);
  });

  test.each([false, true])(
    "keeps host output pressure after a failed close (ACK during close: %s)",
    async (ackDuringClose) => {
      let paused = false;
      let stopAttempts = 0;
      let dataListener: (data: Buffer) => void = () => undefined;
      let exitListener: (event: { exitCode: number; signal: number }) => void = () => undefined;
      const terminationStarted = Promise.withResolvers<void>();
      const finishTermination = Promise.withResolvers<void>();
      const output: Uint8Array[] = [];
      const port = createNodePtyPort({
        processTreeTerminator: () =>
          Effect.promise(async () => {
            stopAttempts += 1;
            if (stopAttempts === 1) {
              terminationStarted.resolve();
              await finishTermination.promise;
              throw new Error("process tree stayed live");
            }
            exitListener({ exitCode: 0, signal: 15 });
          }),
        nodePty: {
          spawn: () => ({
            pid: 42,
            onData: (listener) => {
              dataListener = listener;
              return { dispose: () => undefined };
            },
            onExit: (listener) => {
              exitListener = listener;
              return { dispose: () => undefined };
            },
            write: () => undefined,
            resize: () => undefined,
            pause: () => {
              paused = true;
            },
            resume: () => {
              paused = false;
            },
          }),
        },
      });
      const handle = await Effect.runPromise(
        port.start(
          { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
          {
            onOutput: (data) => output.push(data),
            onFailure: () => undefined,
            onExit: () => undefined,
          },
        ),
      );
      const emitOutput = (data: string) => {
        if (!paused) dataListener(Buffer.from(data));
      };

      await Effect.runPromise(handle.pauseOutput());
      const termination = Effect.runPromise(handle.terminate());
      await terminationStarted.promise;
      if (ackDuringClose) await Effect.runPromise(handle.resumeOutput());
      finishTermination.resolve();
      await expect(termination).rejects.toThrow("node-pty process-tree termination failed");
      expect(paused).toBe(!ackDuringClose);
      emitOutput("new output");
      expect(output).toEqual(ackDuringClose ? [new TextEncoder().encode("new output")] : []);

      if (!ackDuringClose) await Effect.runPromise(handle.resumeOutput());
      emitOutput("after ACK");
      expect(output.at(-1)).toEqual(new TextEncoder().encode("after ACK"));
      await Effect.runPromise(handle.terminate());
      expect(stopAttempts).toBe(2);
    },
  );

  test("preserves Windows UTF-8 text output without terminating the PTY", async () => {
    let dataListener: (data: string | Buffer) => void = () => undefined;
    const calls: string[] = [];
    const port = createNodePtyPort({
      processTreeTerminator: (input) =>
        Effect.sync(() => {
          calls.push(`terminate-tree:${input.pid}`);
        }),
      nodePty: {
        spawn: () => ({
          pid: 42,
          onData: (listener: (data: string | Buffer) => void) => {
            dataListener = listener;
            return { dispose: () => undefined };
          },
          onExit: () => ({ dispose: () => undefined }),
          write: () => undefined,
          resize: () => undefined,
          pause: () => undefined,
          resume: () => undefined,
        }),
      },
    });
    const failures: string[] = [];
    const output: Uint8Array[] = [];
    await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        {
          onOutput: (data) => output.push(data),
          onFailure: (failure) => failures.push(failure.message),
          onExit: () => undefined,
        },
      ),
    );
    dataListener("\u001b[32mPrêt 日本語 🦆\u001b[0m\r\nC:\\repo>");
    expect(failures).toEqual([]);
    expect(output).toEqual([
      new TextEncoder().encode("\u001b[32mPrêt 日本語 🦆\u001b[0m\r\nC:\\repo>"),
    ]);
    await Bun.sleep(0);
    expect(calls).toEqual([]);
  });
});
