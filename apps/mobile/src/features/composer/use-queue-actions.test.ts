import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useQueueActions } from "./use-queue-actions";

describe("useQueueActions", () => {
  test("runs the success step only after the host action succeeds", async () => {
    const { result } = renderHook(() => useQueueActions());
    const save = Promise.withResolvers<void>();
    let successes = 0;
    act(() =>
      result.current.run(
        "a",
        "save_edit",
        () => save.promise,
        () => {
          successes += 1;
        },
      ),
    );
    expect(successes).toBe(0);

    await act(async () => save.resolve());
    expect(successes).toBe(1);
  });

  test("clears a message failure only when that message runs another action", async () => {
    const { result } = renderHook(() => useQueueActions());
    await act(async () =>
      result.current.run("a", "steer", () => Promise.reject(new Error("The host refused it."))),
    );
    expect(result.current.failures.get("a")).toMatchObject({
      title: "Queued message action failed",
      message: "The host refused it.",
    });

    await act(async () => result.current.run("b", "remove", async () => {}));
    expect(result.current.failures.has("a")).toBe(true);

    const retry = Promise.withResolvers<void>();
    act(() => result.current.run("a", "remove", () => retry.promise));
    expect(result.current.failures.has("a")).toBe(false);
    await act(async () => retry.resolve());
  });
});
