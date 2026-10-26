import { describe, expect, test } from "bun:test";
import {
  applyTerminalKeyModifiers,
  encodeTerminalTouchKey,
  type TerminalKeyModifiers,
} from "./terminal-keyboard-policy";

const NONE: TerminalKeyModifiers = { ctrl: false, alt: false };
const CTRL: TerminalKeyModifiers = { ctrl: true, alt: false };
const ALT: TerminalKeyModifiers = { ctrl: false, alt: true };
const CTRL_ALT: TerminalKeyModifiers = { ctrl: true, alt: true };
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("encodeTerminalTouchKey", () => {
  test("sends Escape and Tab, with the escape prefix for Alt", () => {
    expect(text(encodeTerminalTouchKey("Escape", NONE, "linux", false))).toBe("\u001b");
    expect(text(encodeTerminalTouchKey("Escape", ALT, "linux", false))).toBe("\u001b\u001b");
    expect(text(encodeTerminalTouchKey("Tab", NONE, "darwin", false))).toBe("\t");
    expect(text(encodeTerminalTouchKey("Tab", ALT, "darwin", false))).toBe("\u001b\t");
  });

  test("follows the cursor key mode of the terminal application", () => {
    expect(text(encodeTerminalTouchKey("ArrowUp", NONE, "linux", false))).toBe("\u001b[A");
    expect(text(encodeTerminalTouchKey("ArrowDown", NONE, "linux", false))).toBe("\u001b[B");
    expect(text(encodeTerminalTouchKey("ArrowRight", NONE, "win32", false))).toBe("\u001b[C");
    expect(text(encodeTerminalTouchKey("ArrowLeft", NONE, "darwin", false))).toBe("\u001b[D");
    expect(text(encodeTerminalTouchKey("ArrowUp", NONE, "linux", true))).toBe("\u001bOA");
    expect(text(encodeTerminalTouchKey("ArrowLeft", NONE, "darwin", true))).toBe("\u001bOD");
  });

  test("uses the host shortcuts of the keyboard policy first", () => {
    // macOS Option+Left and Option+Right move by word.
    expect([...encodeTerminalTouchKey("ArrowLeft", ALT, "darwin", false)]).toEqual([27, 98]);
    expect([...encodeTerminalTouchKey("ArrowRight", ALT, "darwin", false)]).toEqual([27, 102]);
    // Linux Ctrl+Left and Ctrl+Right move by word.
    expect([...encodeTerminalTouchKey("ArrowLeft", CTRL, "linux", false)]).toEqual([27, 98]);
    expect([...encodeTerminalTouchKey("ArrowRight", CTRL, "linux", false)]).toEqual([27, 102]);
  });

  test("uses only the xterm encoding while the host platform is unknown", () => {
    expect(text(encodeTerminalTouchKey("ArrowLeft", ALT, null, false))).toBe("\u001b[1;3D");
    expect(text(encodeTerminalTouchKey("ArrowLeft", CTRL, null, false))).toBe("\u001b[1;5D");
  });

  test("sends the xterm modifier parameter for other modified arrows", () => {
    expect(text(encodeTerminalTouchKey("ArrowUp", CTRL, "linux", false))).toBe("\u001b[1;5A");
    expect(text(encodeTerminalTouchKey("ArrowLeft", CTRL, "darwin", true))).toBe("\u001b[1;5D");
    expect(text(encodeTerminalTouchKey("ArrowUp", ALT, "linux", false))).toBe("\u001b[1;3A");
    expect(text(encodeTerminalTouchKey("ArrowLeft", ALT, "win32", false))).toBe("\u001b[1;3D");
    expect(text(encodeTerminalTouchKey("ArrowDown", CTRL_ALT, "win32", false))).toBe("\u001b[1;7B");
  });
});

describe("applyTerminalKeyModifiers", () => {
  test("turns Ctrl and a letter into its control byte", () => {
    expect(applyTerminalKeyModifiers("c", CTRL)).toBe("\u0003");
    expect(applyTerminalKeyModifiers("C", CTRL)).toBe("\u0003");
    expect(applyTerminalKeyModifiers("d", CTRL)).toBe("\u0004");
    expect(applyTerminalKeyModifiers("[", CTRL)).toBe("\u001b");
    expect(applyTerminalKeyModifiers(" ", CTRL)).toBe("\u0000");
    expect(applyTerminalKeyModifiers("?", CTRL)).toBe("\u007f");
  });

  test("adds the escape prefix for Alt", () => {
    expect(applyTerminalKeyModifiers("b", ALT)).toBe("\u001bb");
    expect(applyTerminalKeyModifiers("x", CTRL_ALT)).toBe("\u001b\u0018");
  });

  test("keeps characters without a control byte and longer text", () => {
    expect(applyTerminalKeyModifiers("1", CTRL)).toBe("1");
    expect(applyTerminalKeyModifiers("é", CTRL)).toBe("é");
    expect(applyTerminalKeyModifiers("ls", CTRL_ALT)).toBe("ls");
    expect(applyTerminalKeyModifiers("q", NONE)).toBe("q");
    expect(applyTerminalKeyModifiers("😀", ALT)).toBe("\u001b😀");
  });
});
