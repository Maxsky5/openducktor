import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createDeferred } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useQueueActions } from "./use-queue-actions";

// The frontend-core test of useQueuedMessageActionRuns covers the run of each message.
describe("useQueueActions", () => {
  test("runs the success step of an action and ends its run", async () => {
    const { result } = renderHook(() => useQueueActions());
    const save = createDeferred<void>();
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
    expect(result.current.running.get("a")?.kind).toBe("save_edit");

    act(() => save.resolve());
    await waitFor(() => expect(result.current.running.has("a")).toBe(false));
    expect(successes).toBe(1);
  });

  test("keeps the failure of a message until its next action", async () => {
    const { result } = renderHook(() => useQueueActions());
    act(() =>
      result.current.run("a", "steer", () => Promise.reject(new Error("The host refused it."))),
    );
    await waitFor(() =>
      expect(result.current.failures.get("a")?.title).toBe("Queued message action failed"),
    );

    act(() => result.current.run("a", "remove", () => new Promise<void>(() => {})));
    expect(result.current.failures.has("a")).toBe(false);
  });
});
