import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (globalThis.document === undefined) GlobalRegistrator.register();

const { Terminal } = await import("@xterm/xterm");
const { restoreTerminalPrecedingJoinState } = await import("./terminal-rep-state");
const write = (terminal: InstanceType<typeof Terminal>, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));

test("restores browser xterm REP state after screen control sequences", async () => {
  const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
  const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
  try {
    await write(original, "A");
    // SAFETY: xterm 6.0.0 stores REP state on its parser.
    const state = (
      original as InstanceType<typeof Terminal> & {
        _core: { _inputHandler: { _parser: { precedingJoinState: number } } };
      }
    )._core._inputHandler._parser.precedingJoinState;
    await write(restored, "A\u000f");
    restoreTerminalPrecedingJoinState(restored, state);
    await Promise.all([write(original, "\u001b[3b"), write(restored, "\u001b[3b")]);
    expect(restored.buffer.active.getLine(0)?.translateToString()).toBe("AAAA    ");
    expect(restored.buffer.active.getLine(0)?.translateToString()).toBe(
      original.buffer.active.getLine(0)?.translateToString(),
    );
  } finally {
    original.dispose();
    restored.dispose();
  }
});
