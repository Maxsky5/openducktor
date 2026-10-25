import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { usePullRefresh } from "./use-pull-refresh";

const deferred = () => {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe("usePullRefresh", () => {
  test("keeps the spinner until the refresh of the pull settles", async () => {
    const read = deferred();
    const { result } = renderHook(() => usePullRefresh(() => read.promise));
    expect(result.current.pulling).toBe(false);

    act(() => result.current.pull());
    expect(result.current.pulling).toBe(true);

    await act(async () => {
      read.resolve();
      await read.promise;
    });
    expect(result.current.pulling).toBe(false);
  });

  test("ends the spinner when the refresh fails", async () => {
    const read = deferred();
    const { result } = renderHook(() => usePullRefresh(() => read.promise));

    act(() => result.current.pull());
    await act(async () => {
      read.reject(new Error("Host unreachable"));
      await read.promise.catch(() => {});
    });
    expect(result.current.pulling).toBe(false);
  });
});
