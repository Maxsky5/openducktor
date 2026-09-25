import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import type { IBufferCell } from "@xterm/headless";
import { TerminalScreenState } from "./terminal-screen-state";

const encoder = new TextEncoder();
const write = (terminal: Terminal, data: Uint8Array): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));
const writeScreen = (screen: TerminalScreenState, data: Uint8Array): Promise<void> =>
  new Promise((resolve) => screen.write(data, resolve));
const visibleLines = (terminal: Terminal): string[] =>
  Array.from(
    { length: terminal.rows },
    (_, row) => terminal.buffer.active.getLine(row)?.translateToString() ?? "",
  );
const underlineAttributes = (cell: IBufferCell | undefined) => {
  if (!cell) throw new Error("Expected a terminal cell");
  // SAFETY: xterm 6.0.0 buffer cells inherit these attribute methods.
  const attributes = cell as IBufferCell & {
    getUnderlineStyle(): number;
    getUnderlineColor(): number;
  };
  return { style: attributes.getUnderlineStyle(), color: attributes.getUnderlineColor() };
};
const cursorAppearance = (terminal: Terminal) => {
  // SAFETY: xterm 6.0.0 stores DECSCUSR state in these core modes.
  const xterm = terminal as Terminal & {
    _core: { coreService: { decPrivateModes: { cursorStyle?: string; cursorBlink?: boolean } } };
  };
  const { cursorStyle, cursorBlink } = xterm._core.coreService.decPrivateModes;
  return { cursorStyle, cursorBlink };
};

describe("TerminalScreenState", () => {
  test.each([
    ["plain", "A"],
    ["styled", "\u001b[31mA"],
    ["alternate", "\u001b[?1049hA"],
  ])("restores REP after a %s screen snapshot", async (_name, first) => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const initial = encoder.encode(first);
    await Promise.all([writeScreen(screen, initial), write(original, initial)]);
    const snapshot = screen.snapshot();
    expect(snapshot.precedingJoinState).not.toBe(0);
    await write(restored, snapshot.payload);
    // SAFETY: xterm 6.0.0 stores REP state on its parser. The browser applies this snapshot field.
    const restoredParser = (
      restored as Terminal & {
        _core: { _inputHandler: { _parser: { precedingJoinState: number } } };
      }
    )._core._inputHandler._parser;
    restoredParser.precedingJoinState = snapshot.precedingJoinState;
    const continuation = encoder.encode("\u001b[3b");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["without a reset", ""],
    ["after DECSTR", "\u001b[!p"],
    ["after RIS", "\u001bc"],
  ])("restores cursor style %s", async (_name, reset) => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`\u001b[5 q${reset}A`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(cursorAppearance(restored)).toEqual(cursorAppearance(original));
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["G0", "\u001b(0"],
    ["G1", "\u001b)0\u000e"],
    ["G1 alternate", "\u001b-0\u000e"],
    ["G2", "\u001b.0\u001bn"],
    ["G3", "\u001b+0\u001bo"],
  ])("keeps %s line drawing active after restore", async (_name, selection) => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode(selection);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("qq");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("──");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each(["\u001b[!p", "\u001b[?2h"])(
    "keeps the default character set after %s reset",
    async (reset) => {
      const screen = new TerminalScreenState({ columns: 8, rows: 2 });
      const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
      const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
      const first = encoder.encode("\u001b(0" + reset);
      await Promise.all([writeScreen(screen, first), write(original, first)]);
      await write(restored, screen.snapshot().payload);
      const continuation = encoder.encode("qq");
      await Promise.all([
        writeScreen(screen, continuation),
        write(original, continuation),
        write(restored, continuation),
      ]);
      expect(visibleLines(original)[0]).toStartWith("qq");
      expect(visibleLines(restored)).toEqual(visibleLines(original));
      screen.dispose();
      original.dispose();
      restored.dispose();
    },
  );

  test("keeps the saved character set for later cursor restore", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b(0\u001b7\u001b(B");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8q");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("─");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the active character set after restoring a saved cursor", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b7\u001b(0\u001b8");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("q\u001b(0q");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("q─");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps each screen buffer's saved character set", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b(0\u001b[?1049h\u001b(B");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8q");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(original.buffer.active.type).toBe("alternate");
    expect(visibleLines(original)[0]).toStartWith("q");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the normal screen's saved character set when leaving an alternate screen", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b(0\u001b[?1049h\u001b(BALT");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    const continuation = encoder.encode("\u001b[?1049lq");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(original.buffer.active.type).toBe("normal");
    expect(visibleLines(original)[0]).toStartWith("─");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the normal cursor when a 47 mode TUI exits after restore", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("ab\u001b[?47hALT");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    const continuation = encoder.encode("\u001b[?47lq");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores after a long colored log with no saved cursor", async () => {
    const screen = new TerminalScreenState({ columns: 80, rows: 24 });
    const bytes = encoder.encode("\u001b[31m".repeat(16_000));
    await writeScreen(screen, bytes);
    expect(() => screen.snapshot()).not.toThrow();
    screen.dispose();
  });

  test("restores after repeated SGR resets with a saved cursor", async () => {
    const screen = new TerminalScreenState({ columns: 80, rows: 24 });
    const original = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const restored = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const bytes = encoder.encode("\u001b[31mA\u001b7" + "\u001b[32m\u001b[0m".repeat(16_000));
    await Promise.all([writeScreen(screen, bytes), write(original, bytes)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.getLine(0)?.getCell(1)?.getFgColor()).toBe(
      original.buffer.active.getLine(0)?.getCell(1)?.getFgColor(),
    );
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps saved and current colors after many changes without a reset", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const bytes = encoder.encode("\u001b[31mA\u001b7" + "\u001b[32m\u001b[34m".repeat(16_000));
    await Promise.all([writeScreen(screen, bytes), write(original, bytes)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(restored.buffer.active.getLine(0)?.getCell(1)?.getFgColor()).toBe(
      original.buffer.active.getLine(0)?.getCell(1)?.getFgColor(),
    );
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores saved truecolor and text flags used by later TUI output", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[1;4;38;2;12;34;56mA\u001b7\u001b[0m");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    const originalCell = original.buffer.active.getLine(0)?.getCell(1);
    const restoredCell = restored.buffer.active.getLine(0)?.getCell(1);
    expect(restoredCell?.getFgColor()).toBe(originalCell?.getFgColor());
    expect(restoredCell?.isBold()).toBe(originalCell?.isBold());
    expect(restoredCell?.isUnderline()).toBe(originalCell?.isUnderline());
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["double", "\u001b[4:2m", 2],
    ["curly with RGB color", "\u001b[4:3;58;2;12;34;56m", 3],
    ["dotted with palette color", "\u001b[4:4;58;5;123m", 4],
  ])("restores visible %s underline and later text", async (_name, style, expectedStyle) => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`${style}AB`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("C");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    for (let column = 0; column < 3; column += 1) {
      const originalCell = underlineAttributes(original.buffer.active.getLine(0)?.getCell(column));
      const restoredCell = underlineAttributes(restored.buffer.active.getLine(0)?.getCell(column));
      expect(originalCell.style).toBe(expectedStyle);
      expect(restoredCell.style).toBe(expectedStyle);
      expect(restoredCell.color).toBe(originalCell.color);
    }
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores underline color set before underline starts", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[58;2;12;34;56mA");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b[4mB");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    const originalCell = underlineAttributes(original.buffer.active.getLine(0)?.getCell(1));
    const restoredCell = underlineAttributes(restored.buffer.active.getLine(0)?.getCell(1));
    expect(originalCell.color).toBe(0x0c2238);
    expect(restoredCell.color).toBe(originalCell.color);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["visible protected cells", '\u001b[1"qA\u001b[0"qB', "\u001b[?2K", "A"],
    ["current protection", '\u001b[1"qA', "B\u001b[?2K", "AB"],
    ["saved cursor protection", '\u001b[1"q\u001b7\u001b[0"qA', "\u001b8B\u001b[?2K", "B"],
    ["alternate screen protection", '\u001b[?1049h\u001b[1"qA\u001b[0"qB', "\u001b[?2K", "A"],
  ])("restores %s for later selective erase", async (_name, initial, continuation, expected) => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode(initial);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode(continuation);
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(original)[0]).toStartWith(expected);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores decorated cells in both buffers and their cursors", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[4:3;58;2;12;34;56mN\u001b[?1049h\u001b[4:2mALT");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    const alternateCell = underlineAttributes(restored.buffer.active.getLine(0)?.getCell(1));
    expect(alternateCell.style).toBe(2);
    const continuation = encoder.encode("\u001b[?1049lB");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    const normalCell = underlineAttributes(restored.buffer.active.getLine(0)?.getCell(0));
    const originalCell = underlineAttributes(original.buffer.active.getLine(0)?.getCell(0));
    expect(normalCell.style).toBe(originalCell.style);
    expect(normalCell.color).toBe(originalCell.color);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores pending wrap after a decorated last cell", async () => {
    const screen = new TerminalScreenState({ columns: 4, rows: 2 });
    const original = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[4:3mABCD");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("E");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps alternate origin mode when only normal cells need repair", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const first = encoder.encode("\u001b[4:3mN\u001b[?1049h\u001b[0m\u001b[2;3r\u001b[?6h");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b[1;1HA");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    expect(restored.modes.originMode).toBe(original.modes.originMode);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores the alternate screen's own saved cursor", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[?1049h\u001b[31mA\u001b7\u001b[0m\u001b[2;1HB");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b8C");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(restored.buffer.active.type).toBe("alternate");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.getLine(0)?.getCell(1)?.getFgColor()).toBe(
      original.buffer.active.getLine(0)?.getCell(1)?.getFgColor(),
    );
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores a colored screen larger than one MiB", async () => {
    const grid = { columns: 500, rows: 300 };
    const screen = new TerminalScreenState(grid);
    const restored = new Terminal({ cols: grid.columns, rows: grid.rows, allowProposedApi: true });
    const row = Array.from(
      { length: grid.columns },
      (_, index) => `\u001b[38;5;${index % 256}m${String.fromCharCode(33 + (index % 80))}`,
    ).join("");
    const bytes = encoder.encode(
      Array.from({ length: grid.rows }, (_, index) => `\u001b[0m\u001b[${index + 1};1H${row}`).join(
        "",
      ),
    );
    await writeScreen(screen, bytes);
    const snapshot = screen.snapshot();
    expect(snapshot.payload.byteLength).toBeGreaterThan(1024 * 1024);
    await write(restored, snapshot.payload);
    expect(visibleLines(restored)).toEqual(
      Array.from({ length: grid.rows }, () =>
        Array.from({ length: grid.columns }, (_, column) =>
          String.fromCharCode(33 + (column % 80)),
        ).join(""),
      ),
    );
    screen.dispose();
    restored.dispose();
  });

  test("keeps the screen correct across an oversized unfinished OSC string", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode("before\u001b]0;" + "x".repeat(70_000));
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u0007after");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the screen correct across an oversized unfinished DCS string", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode("before\u001bPz" + "x".repeat(70_000));
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u001b\\after");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["OSC CAN", "\u001b]0;x\u0018"],
    ["OSC SUB", "\u001b]0;x\u001a"],
    ["DCS CAN", "\u001bPz\u0018"],
    ["DCS SUB", "\u001bPz\u001a"],
  ])("restores text after %s cancels a control string", async (_name, sequence) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`A${sequence}B`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("C");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("ABC");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("clears an oversized OSC payload when CAN cancels it", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`A\u001b]0;${"x".repeat(70_000)}\u0018B`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(original)[0]).toStartWith("AB");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each(["\n", "\r", "\t"])(
    "restores an unfinished CSI after executing C0 byte %j",
    async (control) => {
      const screen = new TerminalScreenState({ columns: 12, rows: 4 });
      const original = new Terminal({ cols: 12, rows: 4, allowProposedApi: true });
      const restored = new Terminal({ cols: 12, rows: 4, allowProposedApi: true });
      const first = encoder.encode(`A\u001b[1${control}`);
      await Promise.all([writeScreen(screen, first), write(original, first)]);
      await write(restored, screen.snapshot().payload);
      const continuation = encoder.encode("mB");
      await Promise.all([
        writeScreen(screen, continuation),
        write(original, continuation),
        write(restored, continuation),
      ]);
      expect(visibleLines(restored)).toEqual(visibleLines(original));
      expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
      expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
      screen.dispose();
      original.dispose();
      restored.dispose();
    },
  );

  test.each([
    ["ESC with LF", "A\u001b\n", "(0B"],
    ["ESC with CR", "A\u001b\r", "(0B"],
    ["ESC with TAB", "A\u001b\t", "(0B"],
    ["ESC intermediate with LF", "A\u001b(\n", "0B"],
    ["ESC intermediate with CR", "A\u001b(\r", "0B"],
    ["ESC intermediate with TAB", "A\u001b(\t", "0B"],
  ])("restores after %s executes a C0 byte", async (_name, first, continuation) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 4 });
    const original = new Terminal({ cols: 12, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 4, allowProposedApi: true });
    const bytes = encoder.encode(first);
    await Promise.all([writeScreen(screen, bytes), write(original, bytes)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode(continuation);
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["ESC", "A\u001b\u001b"],
    ["ESC intermediate", "A\u001b(\u001b"],
  ])("restores after ESC restarts %s", async (_name, first) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const bytes = encoder.encode(first);
    await Promise.all([writeScreen(screen, bytes), write(original, bytes)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("[31mBC");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(original)[0]).toStartWith("ABC");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["OSC", "\u001b]0;x"],
    ["DCS", "\u001bPzx"],
  ])("restores a new CSI after ESC ends %s", async (_name, sequence) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`A${sequence}\u001b[31mB`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("C");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("ABC");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["ground", ""],
    ["ESC", "\u001b"],
    ["ESC intermediate", "\u001b("],
    ["CSI", "\u001b[31"],
    ["OSC", "\u001b]0;x"],
    ["DCS", "\u001bPzx"],
    ["SOS", "\u001bXx"],
    ["PM", "\u001b^x"],
    ["APC", "\u001b_x"],
  ])("restores a UTF-8 C1 IND from %s", async (_name, prefix) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 3 });
    const original = new Terminal({ cols: 12, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 3, allowProposedApi: true });
    const first = new Uint8Array([...encoder.encode(`A${prefix}`), 0xc2, 0x84]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    const continuation = encoder.encode("B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores a UTF-8 C1 IND split across writes in CSI", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 3 });
    const original = new Terminal({ cols: 12, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 3, allowProposedApi: true });
    const first = new Uint8Array([...encoder.encode("A\u001b[31"), 0xc2]);
    const last = new Uint8Array([0x84]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await Promise.all([writeScreen(screen, last), write(original, last)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("tracks a UTF-8 C1 CSI that replaces an unfinished CSI", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = new Uint8Array([...encoder.encode("A\u001b[31"), 0xc2, 0x9b, 0x33, 0x32]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    const snapshot = screen.snapshot();
    expect(new TextDecoder().decode(snapshot.payload)).toEndWith("\u001b[32");
    await write(restored, snapshot.payload);
    const continuation = encoder.encode("mB");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps an ordinary split two-byte UTF-8 character", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = new Uint8Array([0x41, 0xc2]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = new Uint8Array([0xa0, 0x42]);
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores after an oversized OSC ends with ESC before a new CSI", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode(`A\u001b]0;${"x".repeat(70_000)}\u001b`);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("[31mBC");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("ABC");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([
    ["CSI", [0xc2, 0x9b, 0x33, 0x31], encoder.encode("mB")],
    ["OSC", [0xc2, 0x9d, 0x30, 0x3b, 0x78], encoder.encode("\u0007B")],
    ["DCS", [0xc2, 0x90, 0x7a, 0x78], encoder.encode("\u001b\\B")],
    ["SOS", [0xc2, 0x98, 0x78], encoder.encode("\u001b\\B")],
    ["PM", [0xc2, 0x9e, 0x78], encoder.encode("\u001b\\B")],
    ["APC", [0xc2, 0x9f, 0x78], encoder.encode("\u001b\\B")],
  ])("restores an unfinished UTF-8 C1 %s control", async (_name, bytes, continuation) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = new Uint8Array([0x41, ...bytes]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("AB");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores a UTF-8 C1 CSI introducer split across writes", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = new Uint8Array([0x41, 0xc2]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = new Uint8Array([0x9b, 0x33, 0x31, 0x6d, 0x42]);
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("AB");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test.each([false, true])(
    "restores a split UTF-8 C1 string terminator with discarded payload %s",
    async (oversized) => {
      const screen = new TerminalScreenState({ columns: 12, rows: 2 });
      const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
      const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
      const first = encoder.encode(`A\u001b]0;${oversized ? "x".repeat(70_000) : "x"}`);
      const split = new Uint8Array([...first, 0xc2]);
      await Promise.all([writeScreen(screen, split), write(original, split)]);
      await write(restored, screen.snapshot().payload);
      const continuation = new Uint8Array([0x9c, 0x42]);
      await Promise.all([
        writeScreen(screen, continuation),
        write(original, continuation),
        write(restored, continuation),
      ]);
      expect(visibleLines(original)[0]).toStartWith("AB");
      expect(visibleLines(restored)).toEqual(visibleLines(original));
      expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
      screen.dispose();
      original.dispose();
      restored.dispose();
    },
  );

  test.each([
    ["OSC", "\u001b]0;"],
    ["DCS", "\u001bPz"],
    ["SOS", "\u001bX"],
    ["PM", "\u001b^"],
    ["APC", "\u001b_"],
  ])("restores UTF-8 C1 CSI after a discarded %s payload", async (_name, intro) => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const prefix = encoder.encode(`A${intro}${"x".repeat(70_000)}`);
    const first = new Uint8Array(prefix.byteLength + 4);
    first.set(prefix);
    first.set([0xc2, 0x9b, 0x33, 0x31], prefix.byteLength);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("mB");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("AB");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores UTF-8 C1 OSC after a discarded DCS payload", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const prefix = encoder.encode(`A\u001bPz${"x".repeat(70_000)}`);
    const first = new Uint8Array(prefix.byteLength + 5);
    first.set(prefix);
    first.set([0xc2, 0x9d, 0x30, 0x3b, 0x78], prefix.byteLength);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const continuation = encoder.encode("\u0007B");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(visibleLines(original)[0]).toStartWith("AB");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("bounds an unfinished long CSI and restores after it ends", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 2 });
    const original = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    const first = encoder.encode("before\u001b[" + "1;".repeat(40_000));
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    expect(() => screen.snapshot()).toThrow("Terminal control sequence is too long to restore");
    const continuation = encoder.encode("mafter");
    await Promise.all([writeScreen(screen, continuation), write(original, continuation)]);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the latest screen rows after a long log stream", async () => {
    const screen = new TerminalScreenState({ columns: 12, rows: 3 });
    const restored = new Terminal({ cols: 12, rows: 3, allowProposedApi: true });
    const log = encoder.encode(
      Array.from({ length: 1_000 }, (_, index) => `line ${index}`).join("\r\n"),
    );
    await writeScreen(screen, log);
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toContain("line 999    ");
    expect(visibleLines(restored).join(" ")).not.toContain("line 0");
    screen.dispose();
    restored.dispose();
  });

  test("restores an alternate screen and continues a split CSI sequence", async () => {
    const grid = { columns: 12, rows: 3 };
    const screen = new TerminalScreenState(grid);
    const original = new Terminal({ cols: grid.columns, rows: grid.rows, allowProposedApi: true });
    const restored = new Terminal({ cols: grid.columns, rows: grid.rows, allowProposedApi: true });
    const initial = encoder.encode("normal\u001b[?1049hALT\u001b[?25l\u001b[31");
    await Promise.all([writeScreen(screen, initial), write(original, initial)]);

    const snapshot = screen.snapshot();
    expect(new TextDecoder().decode(snapshot.payload)).toEndWith("\u001b[?25l\u001b[31");
    await write(restored, snapshot.payload);

    const continuation = encoder.encode("mRED\u001b[0m");
    await Promise.all([
      writeScreen(screen, continuation),
      write(original, continuation),
      write(restored, continuation),
    ]);
    expect(restored.buffer.active.type).toBe("alternate");
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores an unfinished UTF-8 character before later bytes", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 2 });
    const original = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 2, allowProposedApi: true });
    const first = new Uint8Array([0x61, 0xe2, 0x82]);
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const last = new Uint8Array([0xac]);
    await Promise.all([writeScreen(screen, last), write(original, last), write(restored, last)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("continues scrolling inside a TUI scroll region", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const first = encoder.encode(
      "\u001b[?1049h\u001b[1;1H11111111\u001b[2;1H22222222\u001b[3;1H33333333\u001b[4;1H44444444\u001b[2;3r\u001b[3;1H",
    );
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\nNEW");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the correct scroll region after entering the alternate screen", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const first = encoder.encode(
      "\u001b[2;3r\u001b[?1049h\u001b[1;1H11111111\u001b[2;1H22222222\u001b[3;1H33333333\u001b[4;1H44444444\u001b[4;1H",
    );
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\nNEW");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the correct scroll region after leaving the alternate screen", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const first = encoder.encode(
      "\u001b[1;1H11111111\u001b[2;1H22222222\u001b[3;1H33333333\u001b[4;1H44444444\u001b[2;3r\u001b[?1049hALT\u001b[?1049l\u001b[3;1H",
    );
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\nNEW");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps origin mode and cursor position inside a scroll region", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const first = encoder.encode(
      "\u001b[?1049h\u001b[1;1H11111111\u001b[2;1H22222222\u001b[3;1H33333333\u001b[4;1H44444444\u001b[2;3r\u001b[?6h\u001b[2;1H",
    );
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\nNEW");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    expect(restored.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores scroll state after a grid resize", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 4 });
    const original = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 5, allowProposedApi: true });
    const first = encoder.encode("\u001b[2;3r\u001b[3;1HABC");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    screen.resize({ columns: 8, rows: 5 });
    original.resize(8, 5);
    await screen.drained();
    await write(restored, screen.snapshot().payload);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    const next = encoder.encode("\nNEW");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("continues a line that ends at the right edge", async () => {
    const screen = new TerminalScreenState({ columns: 4, rows: 2 });
    const original = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const first = encoder.encode("ABCD");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("E");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("continues a saved cursor at the right edge", async () => {
    const screen = new TerminalScreenState({ columns: 4, rows: 2 });
    const original = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 4, rows: 2, allowProposedApi: true });
    const first = encoder.encode("ABCD\u001b7\u001b[2;1HX");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\u001b8E");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps a pending line wrap while restoring a saved cursor", async () => {
    const screen = new TerminalScreenState({ columns: 4, rows: 3 });
    const original = new Terminal({ cols: 4, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 4, rows: 3, allowProposedApi: true });
    const first = encoder.encode("X\u001b7\u001b[2;1HABCD");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("E");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps a pending line wrap after a wide final cell", async () => {
    const screen = new TerminalScreenState({ columns: 4, rows: 3 });
    const original = new Terminal({ cols: 4, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 4, rows: 3, allowProposedApi: true });
    const first = encoder.encode("X\u001b7\u001b[2;3H界");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("E");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores a saved cursor used by later TUI output", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 3 });
    const original = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const first = encoder.encode("A\u001b7\u001b[2;1HB");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\u001b8C");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("restores the color saved with the cursor", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 3 });
    const original = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const first = encoder.encode("\u001b[31mA\u001b7\u001b[32m\u001b[2;1HB");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\u001b8C");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(restored.buffer.active.getLine(0)?.getCell(1)?.getFgColor()).toBe(
      original.buffer.active.getLine(0)?.getCell(1)?.getFgColor(),
    );
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps the restored color through another reconnect", async () => {
    const screen = new TerminalScreenState({ columns: 8, rows: 3 });
    const original = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const restored = new Terminal({ cols: 8, rows: 3, allowProposedApi: true });
    const first = encoder.encode("\u001b[31mA\u001b7\u001b[32m\u001b[2;1HB\u001b8C");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("D");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(restored.buffer.active.getLine(0)?.getCell(2)?.getFgColor()).toBe(
      original.buffer.active.getLine(0)?.getCell(2)?.getFgColor(),
    );
    screen.dispose();
    original.dispose();
    restored.dispose();
  });

  test("keeps custom tab stops for later TUI output", async () => {
    const screen = new TerminalScreenState({ columns: 16, rows: 2 });
    const original = new Terminal({ cols: 16, rows: 2, allowProposedApi: true });
    const restored = new Terminal({ cols: 16, rows: 2, allowProposedApi: true });
    const first = encoder.encode("\u001b[3g\u001b[1;5H\u001bH\u001b[1;1H");
    await Promise.all([writeScreen(screen, first), write(original, first)]);
    await write(restored, screen.snapshot().payload);
    const next = encoder.encode("\tX");
    await Promise.all([writeScreen(screen, next), write(original, next), write(restored, next)]);
    expect(visibleLines(restored)).toEqual(visibleLines(original));
    screen.dispose();
    original.dispose();
    restored.dispose();
  });
});
