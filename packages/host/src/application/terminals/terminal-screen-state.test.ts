import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
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

describe("TerminalScreenState", () => {
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
