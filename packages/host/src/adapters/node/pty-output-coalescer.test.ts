import { describe, expect, test } from "bun:test";
import {
  createPtyOutputCoalescer,
  PTY_OUTPUT_MAX_BYTES,
  PTY_OUTPUT_WINDOW_MS,
} from "./pty-output-coalescer";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** A coalescer on a test clock. `advance` runs the timer when its time comes. */
const createTestCoalescer = () => {
  let time = 1000;
  let timer: { at: number; run: () => void } | null = null;
  const deliveries: string[] = [];
  const coalescer = createPtyOutputCoalescer({
    deliver: (data) => deliveries.push(new TextDecoder().decode(data)),
    now: () => time,
    schedule: (run, delayMs) => {
      const scheduled = { at: time + delayMs, run };
      timer = scheduled;
      return () => {
        if (timer === scheduled) timer = null;
      };
    },
  });
  return {
    coalescer,
    deliveries,
    hasTimer: () => timer !== null,
    advance: (ms: number): void => {
      time += ms;
      const due = timer;
      if (due && due.at <= time) {
        timer = null;
        due.run();
      }
    },
  };
};

describe("createPtyOutputCoalescer", () => {
  test("sends output after a quiet period at once and joins the output of one frame", () => {
    const { coalescer, deliveries, advance } = createTestCoalescer();

    coalescer.push(text("$ "));
    expect(deliveries).toEqual(["$ "]);

    advance(2);
    coalescer.push(text("line 1\r\n"));
    advance(2);
    coalescer.push(text("line 2\r\n"));
    expect(deliveries).toEqual(["$ "]);

    advance(PTY_OUTPUT_WINDOW_MS);
    expect(deliveries).toEqual(["$ ", "line 1\r\nline 2\r\n"]);
  });

  test("sends waiting output at once when it reaches the size limit", () => {
    const { coalescer, deliveries, advance, hasTimer } = createTestCoalescer();
    coalescer.push(text("$ "));
    advance(1);

    coalescer.push(new Uint8Array(PTY_OUTPUT_MAX_BYTES - 1));
    expect(deliveries).toHaveLength(1);
    coalescer.push(text("x"));

    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toHaveLength(PTY_OUTPUT_MAX_BYTES);
    expect(hasTimer()).toBe(false);
  });

  test("sends waiting output when it flushes and cancels the timer", () => {
    const { coalescer, deliveries, advance, hasTimer } = createTestCoalescer();
    coalescer.push(text("first"));
    advance(1);
    coalescer.push(text("last"));
    expect(hasTimer()).toBe(true);

    coalescer.flush();

    expect(deliveries).toEqual(["first", "last"]);
    expect(hasTimer()).toBe(false);
  });

  test("delivers a copy that shares no memory with the chunks", () => {
    const delivered: Uint8Array[] = [];
    const coalescer = createPtyOutputCoalescer({ deliver: (data) => delivered.push(data) });
    const pool = new Uint8Array([1, 2, 3, 4]);

    coalescer.push(pool.subarray(1, 3));
    pool.fill(0);

    expect(delivered[0]).toEqual(new Uint8Array([2, 3]));
    expect(delivered[0]?.buffer).not.toBe(pool.buffer);
  });
});
