import { describe, expect, test } from "bun:test";
import { assertTerminalPtyConformance } from "@openducktor/host";
import { Effect } from "effect";
import { createNodePtyPort } from "./node-pty-adapter";

describe("createNodePtyPort", () => {
  test("maps raw output, resize, pause, resume, input, exit, and cleanup", async () => {
    const calls: string[] = [];
    let dataListener: (data: string) => void = () => undefined;
    let exitListener: (event: { exitCode: number; signal?: number }) => void = () => undefined;
    const disposable = () => ({ dispose: () => calls.push("dispose") });
    const port = createNodePtyPort({
      nodePty: {
        spawn: ((_shell: string, _args: string[], options: { encoding?: string | null }) => {
          expect(options.encoding).toBeNull();
          return {
            onData: (listener: (data: string) => void) => {
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
            kill: () => calls.push("kill"),
          };
        }) as never,
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
    dataListener(Buffer.from([1, 2]) as never);
    await Effect.runPromise(handle.write(new Uint8Array([65])));
    await Effect.runPromise(handle.resize({ columns: 120, rows: 40 }));
    await Effect.runPromise(handle.pauseOutput());
    await Effect.runPromise(handle.resumeOutput());
    exitListener({ exitCode: 3, signal: 15 });
    expect(output).toEqual([[1, 2]]);
    expect(exits).toEqual([{ exitCode: 3, signal: "15" }]);
    expect(calls).toContain("write:A");
    expect(calls).toContain("resize:120x40");
    expect(calls).toContain("pause");
    expect(calls).toContain("resume");
    assertTerminalPtyConformance({
      output,
      eventOrder,
      operations: calls,
      supportsOutputPause: handle.supportsOutputPause,
      expectedOutputPause: true,
    });
  });

  test("surfaces an invalid raw-output contract before terminating the PTY", async () => {
    let dataListener: (data: string) => void = () => undefined;
    const calls: string[] = [];
    const port = createNodePtyPort({
      nodePty: {
        spawn: (() => ({
          onData: (listener: (data: string) => void) => {
            dataListener = listener;
            return { dispose: () => undefined };
          },
          onExit: () => ({ dispose: () => undefined }),
          write: () => undefined,
          resize: () => undefined,
          pause: () => undefined,
          resume: () => undefined,
          kill: () => calls.push("kill"),
        })) as never,
      },
    });
    const failures: string[] = [];
    await Effect.runPromise(
      port.start(
        { shell: "/bin/zsh", args: [], cwd: "/repo", env: {}, grid: { columns: 80, rows: 24 } },
        {
          onOutput: () => undefined,
          onFailure: (failure) => failures.push(failure.message),
          onExit: () => undefined,
        },
      ),
    );
    dataListener("unexpected text");
    expect(failures).toEqual(["node-pty emitted text despite raw-buffer mode."]);
    expect(calls).toEqual(["kill"]);
  });
});
