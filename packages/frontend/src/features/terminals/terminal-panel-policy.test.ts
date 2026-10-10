import { describe, expect, test } from "bun:test";
import { isTerminalToggleShortcut } from "./terminal-panel-policy";

describe("terminal panel policy", () => {
  test("recognizes only Ctrl+backtick as the baseline toggle shortcut", () => {
    expect(isTerminalToggleShortcut({ ctrlKey: true, key: "`" })).toBe(true);
    expect(isTerminalToggleShortcut({ ctrlKey: false, key: "`" })).toBe(false);
    expect(isTerminalToggleShortcut({ ctrlKey: true, key: "t" })).toBe(false);
  });
});
