import { describe, expect, test } from "bun:test";
import { createDemoClock, type DemoTimers } from "./demo-clock";

/** Timers that run due timers in reverse order, as a timer queue without a stable order can. */
const reversingTimers = () => {
  const due: (() => void)[] = [];
  const timers: DemoTimers = {
    now: () => 0,
    setTimeout: (run) => {
      due.push(run);
      return due.length;
    },
    clearTimeout: () => {},
  };
  const flush = () => {
    while (due.length > 0) due.pop()?.();
  };
  return { timers, flush };
};

describe("demo clock", () => {
  test("delivers events in publication order when timers run out of order", () => {
    const { timers, flush } = reversingTimers();
    const clock = createDemoClock(new AbortController().signal, timers);
    const seen: number[] = [];
    for (const value of [1, 2, 3]) clock.soon(() => seen.push(value));
    flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  test("delivers no event after the demo ends", () => {
    const { timers, flush } = reversingTimers();
    const lifetime = new AbortController();
    const clock = createDemoClock(lifetime.signal, timers);
    const seen: number[] = [];
    clock.soon(() => seen.push(1));
    lifetime.abort();
    clock.soon(() => seen.push(2));
    flush();
    expect(seen).toEqual([]);
  });
});
