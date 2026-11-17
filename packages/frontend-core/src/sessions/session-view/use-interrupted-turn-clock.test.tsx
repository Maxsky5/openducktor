import "../../test-support/dom-environment";
import { afterEach, expect, jest, setSystemTime, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { usageLimitCountdown } from "./interrupted-turn-copy";
import { useInterruptedTurnClock } from "./use-interrupted-turn-clock";

const START = Date.UTC(2026, 10, 17, 21, 29, 0);
const RESET = START + 3 * 60_000 + 30_000;

afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

test("updates the countdown when the whole minutes left change", () => {
  jest.useFakeTimers();
  setSystemTime(START);
  const { result } = renderHook(() =>
    useInterruptedTurnClock({ resetsAtEpochMs: RESET }, undefined),
  );
  const left = () => usageLimitCountdown(RESET, result.current);

  advance(0);
  expect(left()).toMatchObject({ remaining: "4m" });
  advance(29_000);
  expect(left()).toMatchObject({ remaining: "4m" });
  advance(1_000);
  expect(left()).toMatchObject({ remaining: "3m" });
  advance(3 * 60_000);
  expect(left()).toEqual({ kind: "passed" });
});
