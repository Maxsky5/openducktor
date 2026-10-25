import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { encodeTerminalTouchKey } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import { restoreTerminalPrecedingJoinState } from "@openducktor/frontend-core/terminals/terminal-rep-state";

if (globalThis.document === undefined) GlobalRegistrator.register();

// The page imports the xterm.js module file. This test pins the parts that the page relies on.
const { Terminal } = await import("@xterm/xterm");
const write = (terminal: InstanceType<typeof Terminal>, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));

test("the xterm.js build keeps the REP state and the cursor key mode that the page reads", async () => {
  const terminal = new Terminal({ cols: 8, rows: 2 });
  try {
    await write(terminal, "A");
    expect(() => restoreTerminalPrecedingJoinState(terminal, 0)).not.toThrow();

    expect(terminal.modes.applicationCursorKeysMode).toBe(false);
    await write(terminal, "\u001b[?1h");
    expect(terminal.modes.applicationCursorKeysMode).toBe(true);
    const up = encodeTerminalTouchKey(
      "ArrowUp",
      { ctrl: false, alt: false },
      "linux",
      terminal.modes.applicationCursorKeysMode,
    );
    expect(new TextDecoder().decode(up)).toBe("\u001bOA");
  } finally {
    terminal.dispose();
  }
});
