import { describe, expect, test } from "bun:test";
import { isTerminalToggleShortcut, toggleTerminalPanel } from "./terminal-panel-policy";

describe("terminal panel policy", () => {
  test("opening requests focus while hiding leaves focus unchanged", () => {
    expect(toggleTerminalPanel(false)).toEqual({ visible: true, requestFocus: true });
    expect(toggleTerminalPanel(true)).toEqual({ visible: false, requestFocus: false });
  });

  test("recognizes only Ctrl+backtick as the baseline toggle shortcut", () => {
    expect(isTerminalToggleShortcut({ ctrlKey: true, key: "`" })).toBe(true);
    expect(isTerminalToggleShortcut({ ctrlKey: false, key: "`" })).toBe(false);
    expect(isTerminalToggleShortcut({ ctrlKey: true, key: "t" })).toBe(false);
  });
});
