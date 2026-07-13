import { describe, expect, test } from "bun:test";
import {
  createLatestResizeScheduler,
  enqueueParsedTerminalWrite,
  resolveTerminalKeyAction,
} from "./interactive-terminal-policy";

const keyEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    type: "keydown",
    ...overrides,
  }) as KeyboardEvent;

describe("InteractiveTerminal policies", () => {
  test("keeps copy, paste, and Ctrl+C interrupt semantics distinct", () => {
    expect(resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "c" }), false, true)).toBe(
      "copy",
    );
    expect(resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "c" }), false, false)).toBe(
      "interrupt",
    );
    expect(
      resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "v", shiftKey: true }), false, false),
    ).toBe("paste");
    expect(resolveTerminalKeyAction(keyEvent({ key: "c", metaKey: true }), true, true)).toBe(
      "copy",
    );
  });

  test("coalesces resize bursts to the latest grid and flushes before input", () => {
    const callbacks: Array<() => void> = [];
    const grids: string[] = [];
    const scheduler = createLatestResizeScheduler(
      (columns, rows) => grids.push(`${columns}x${rows}`),
      (callback) => callbacks.push(callback),
    );
    scheduler.schedule(80, 24);
    scheduler.schedule(100, 30);
    scheduler.schedule(120, 40);
    expect(callbacks).toHaveLength(1);
    scheduler.flush();
    expect(grids).toEqual(["120x40"]);
  });

  test("acknowledges output only after the terminal parser callback", async () => {
    const parsed: { value: (() => void) | null } = { value: null };
    const acknowledgements: number[] = [];
    const completed = enqueueParsedTerminalWrite(
      Promise.resolve(),
      (_payload, callback) => {
        parsed.value = callback;
      },
      new Uint8Array([1, 2]),
      () => acknowledgements.push(2),
    );
    await Promise.resolve();
    expect(acknowledgements).toEqual([]);
    const parsedCallback = parsed.value;
    if (!parsedCallback) throw new Error("Expected terminal parser callback.");
    parsedCallback();
    await completed;
    expect(acknowledgements).toEqual([2]);
  });
});
