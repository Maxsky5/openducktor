import "../test-support/dom-environment";
import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { MINIMUM_LOADER_MS, useMinimumLoader } from "./use-minimum-loader";

afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

describe("useMinimumLoader", () => {
  test("shows no loader for content that is ready at once", () => {
    const view = renderHook(({ pending }) => useMinimumLoader(pending), {
      initialProps: { pending: false },
    });

    expect(view.result.current).toBe(false);
  });

  test("keeps a loader that showed until the minimum time ends", () => {
    jest.useFakeTimers();
    setSystemTime(Date.UTC(2026, 9, 27, 10, 0, 0));
    const view = renderHook(({ pending }) => useMinimumLoader(pending), {
      initialProps: { pending: true },
    });
    expect(view.result.current).toBe(true);

    // The read ends fast, so the loader stays for the rest of the minimum time.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    view.rerender({ pending: false });
    expect(view.result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(MINIMUM_LOADER_MS - 101);
    });
    expect(view.result.current).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(view.result.current).toBe(false);
  });

  test("hides a loader at once when the read took longer than the minimum time", () => {
    jest.useFakeTimers();
    setSystemTime(Date.UTC(2026, 9, 27, 10, 0, 0));
    const view = renderHook(({ pending }) => useMinimumLoader(pending), {
      initialProps: { pending: true },
    });

    act(() => {
      jest.advanceTimersByTime(MINIMUM_LOADER_MS + 200);
    });
    view.rerender({ pending: false });

    expect(view.result.current).toBe(false);
  });

  test("keeps pending content hidden during close and starts a fresh interval on reopen", () => {
    jest.useFakeTimers();
    setSystemTime(Date.UTC(2026, 9, 27, 10, 0, 0));
    const view = renderHook(({ pending, active }) => useMinimumLoader(pending, active), {
      initialProps: { pending: true, active: true },
    });
    act(() => jest.advanceTimersByTime(400));
    view.rerender({ pending: true, active: false });
    expect(view.result.current).toBe(true);
    view.rerender({ pending: true, active: true });
    act(() => jest.advanceTimersByTime(100));
    view.rerender({ pending: false, active: true });
    expect(view.result.current).toBe(true);
    act(() => jest.advanceTimersByTime(399));
    expect(view.result.current).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(view.result.current).toBe(false);
  });
});
