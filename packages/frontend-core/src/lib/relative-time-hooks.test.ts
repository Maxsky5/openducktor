import "../test-support/dom-environment";
import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { formatElapsedShort, useMinuteClockLabel } from "./relative-time";

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 21, 10, 0, 30);

afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

describe("useMinuteClockLabel", () => {
  test("renders again only when its own label changes on a minute tick", () => {
    jest.useFakeTimers();
    setSystemTime(START);
    let changingRenders = 0;
    let stillRenders = 0;
    const changing = renderHook(() => {
      changingRenders += 1;
      return useMinuteClockLabel((now) => formatElapsedShort(now - START));
    });
    const still = renderHook(() => {
      stillRenders += 1;
      return useMinuteClockLabel((now) => formatElapsedShort(now - (START - 3 * 60 * MINUTE)));
    });
    expect(changing.result.current).toBe("now");
    expect(still.result.current).toBe("3h");
    changingRenders = 0;
    stillRenders = 0;

    // The fake timers move the system time with them.
    act(() => {
      jest.advanceTimersByTime(MINUTE);
    });

    expect(changing.result.current).toBe("1m");
    expect(changingRenders).toBe(1);
    expect(still.result.current).toBe("3h");
    expect(stillRenders).toBe(0);
  });
});
