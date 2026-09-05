import { describe, expect, test } from "bun:test";
import { assertTerminalPtyConformance } from "@openducktor/host";
import { Effect } from "effect";
import { createNodePtyPort } from "./node-pty-adapter";

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
  ])(
    "classifies silent exit $exitCode, signal $signal, requested close $requestedClose",
    async ({ exitCode, signal, requestedClose, failed }) => {
      let exitListener: (event: { exitCode: number; signal: number }) => void = () => undefined;
      const events: string[] = [];
      const port = createNodePtyPort({
        processTreeTerminator: () => Effect.void,
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
