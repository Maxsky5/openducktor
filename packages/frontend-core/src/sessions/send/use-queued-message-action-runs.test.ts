import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useQueuedMessageActionRuns } from "./use-queued-message-action-runs";

describe("useQueuedMessageActionRuns", () => {
  test("keeps the running action of a message when an action of another message ends", async () => {
    const { result } = renderHook(() => useQueuedMessageActionRuns());
    const removeA = Promise.withResolvers<void>();
    const steerB = Promise.withResolvers<void>();
    act(() => {
      void result.current.track("a", "remove", () => removeA.promise);
      void result.current.track("b", "steer", () => steerB.promise);
    });

    act(() => removeA.resolve());
    await waitFor(() => expect(result.current.running.has("a")).toBe(false));
    expect(result.current.running.get("b")?.kind).toBe("steer");

    act(() => steerB.resolve());
    await waitFor(() => expect(result.current.running.size).toBe(0));
  });

  test("keeps a newer action of the same message when an older one ends", async () => {
    const { result } = renderHook(() => useQueuedMessageActionRuns());
    const beginEdit = Promise.withResolvers<void>();
    const save = Promise.withResolvers<void>();
    let beginEditRun!: Promise<void>;
    act(() => {
      beginEditRun = result.current.track("a", "begin_edit", () => beginEdit.promise);
    });
    act(() => {
      void result.current.track("a", "save_edit", () => save.promise);
    });

    await act(async () => {
      beginEdit.resolve();
      await beginEditRun;
    });
    expect(result.current.running.get("a")?.kind).toBe("save_edit");
  });

  test("ends a failed action and returns its failure", async () => {
    const { result } = renderHook(() => useQueuedMessageActionRuns());
    let failed!: Promise<void>;
    act(() => {
      failed = result.current.track("a", "steer", () =>
        Promise.reject(new Error("The host refused it.")),
      );
    });

    await act(async () => {
      await expect(failed).rejects.toThrow("The host refused it.");
    });
    expect(result.current.running.has("a")).toBe(false);
  });
});
