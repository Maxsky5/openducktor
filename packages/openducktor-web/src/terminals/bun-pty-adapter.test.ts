import { describe, expect, test } from "bun:test";
import { assertTerminalPtyConformance } from "@openducktor/host";
import { Effect } from "effect";
import { type BunPtySpawn, type BunPtySpawnOptions, createBunPtyPort } from "./bun-pty-adapter";

describe("createBunPtyPort", () => {
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
      close: () => calls.push("close"),
    };
    const port = createBunPtyPort({
      platform: "win32",
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
    const options = captured.options;
    if (!options) throw new Error("Expected Bun spawn options to be captured.");
    options.terminal.data(terminal, new Uint8Array([1, 2]));
    await Effect.runPromise(handle.write(new Uint8Array([65])));
    await Effect.runPromise(handle.resize({ columns: 120, rows: 40 }));
    options.onExit({ pid: 42, terminal, kill: () => undefined }, 7, null);
    expect(exits).toEqual([]);
    options.terminal.exit(terminal, 0, null);
    expect(exits).toEqual([{ exitCode: 7, signal: null }]);
    assertTerminalPtyConformance({
      output,
      eventOrder,
      operations: calls,
      supportsOutputPause: handle.supportsOutputPause,
      expectedOutputPause: false,
    });
    await Effect.runPromise(handle.terminate());
    expect(calls.slice(-2)).toEqual(["kill", "close"]);
  });
});
