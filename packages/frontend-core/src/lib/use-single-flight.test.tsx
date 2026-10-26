import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { IsolatedQueryWrapper } from "../test-support/isolated-query-wrapper";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import { useSingleFlight, useSingleFlightMutation } from "./use-single-flight";

/** A promise that stays pending until the test settles it. */
const deferred = <Value,>() => {
  let resolve: (value: Value) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("useSingleFlight", () => {
  test("runs a second action only after the first one ends", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const first = deferred<string>();
    const calls: string[] = [];

    const firstRun = result.current.start(() => {
      calls.push("first");
      return first.promise;
    });
    const doubleTap = result.current.start(async () => {
      calls.push("double tap");
      return "double tap";
    });

    expect(await doubleTap).toBeUndefined();
    first.resolve("created");
    expect(await firstRun).toBe("created");
    expect(await result.current.start(async () => "next")).toBe("next");
    expect(calls).toEqual(["first"]);
  });

  test("gives a failure to the caller and lets the next action run", async () => {
    const { result } = renderHook(() => useSingleFlight());

    const failure = await result.current
      .start(async () => {
        throw new Error("The host refused the command.");
      })
      .catch((cause: Error) => cause);

    expect(failure).toEqual(new Error("The host refused the command."));
    expect(await result.current.start(async () => "retried")).toBe("retried");
  });
});

describe("useSingleFlightMutation", () => {
  test("sends one command for calls that come before the pending state renders", async () => {
    const sent: string[] = [];
    const reply = deferred<string>();
    const { result } = renderHook(
      () =>
        useSingleFlightMutation({
          mutationFn: (name: string) => {
            sent.push(name);
            return reply.promise;
          },
        }),
      { wrapper: IsolatedQueryWrapper },
    );

    const joined: Promise<string>[] = [];
    act(() => {
      result.current.mutate("chat");
      result.current.mutate("chat");
      joined.push(result.current.mutateAsync("chat"));
    });
    await act(async () => reply.resolve("created"));

    expect(await Promise.all(joined)).toEqual(["created"]);
    await waitForExpectation(() => expect(result.current.isSuccess).toBe(true));
    expect(sent).toEqual(["chat"]);

    await act(async () => {
      await result.current.mutateAsync("second chat");
    });
    expect(sent).toEqual(["chat", "second chat"]);
  });

  test("sends a new command after a failed one", async () => {
    let attempts = 0;
    const { result } = renderHook(
      () =>
        useSingleFlightMutation({
          mutationFn: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("The host is not reachable.");
            return "archived";
          },
        }),
      { wrapper: IsolatedQueryWrapper },
    );

    act(() => result.current.mutate());
    await waitForExpectation(() =>
      expect(result.current.error).toEqual(new Error("The host is not reachable.")),
    );
    act(() => result.current.mutate());
    await waitForExpectation(() => expect(result.current.data).toBe("archived"));
    expect(attempts).toBe(2);
  });
});
