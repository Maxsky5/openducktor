import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useChatSessionPreparation } from "./use-chat-session-preparation";

test("preparation blocks submission until success and keeps a failed attempt visible", async () => {
  const pending = Promise.withResolvers<void>();
  const prepare = mock(() => pending.promise);
  const view = renderHook(() =>
    useChatSessionPreparation({ targetKey: "A", enabled: true, prepare }),
  );
  try {
    expect(view.result.current).toEqual({ ready: false, error: null });
    await act(async () => pending.reject(new Error("Runtime could not attach")));
    expect(view.result.current).toEqual({ ready: false, error: "Runtime could not attach" });
    view.rerender();
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});

test("switching chats discards a late result from the old chat", async () => {
  const old = Promise.withResolvers<void>();
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? old.promise : next.promise));
  const view = renderHook(
    ({ targetKey }) => useChatSessionPreparation({ targetKey, enabled: true, prepare }),
    { initialProps: { targetKey: "A" } },
  );
  try {
    view.rerender({ targetKey: "B" });
    await act(async () => old.resolve());
    expect(view.result.current.ready).toBe(false);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
  } finally {
    view.unmount();
  }
});

test("a new visit blocks the first render until the session is prepared again", async () => {
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise));
  const states: boolean[] = [];
  const view = renderHook(
    ({ targetKey }) => {
      const result = useChatSessionPreparation({ targetKey, enabled: true, prepare });
      states.push(result.ready);
      return result;
    },
    { initialProps: { targetKey: "A:1" } },
  );
  try {
    await act(async () => {});
    expect(view.result.current.ready).toBe(true);
    states.length = 0;
    view.rerender({ targetKey: "A:2" });
    expect(states).not.toContain(true);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
  } finally {
    view.unmount();
  }
});

test("losing runtime readiness blocks Send and starts a fresh preparation after recovery", async () => {
  const next = Promise.withResolvers<void>();
  const prepare = mock(() => (prepare.mock.calls.length === 1 ? Promise.resolve() : next.promise));
  const view = renderHook(
    ({ enabled }) => useChatSessionPreparation({ targetKey: "A", enabled, prepare }),
    { initialProps: { enabled: true } },
  );
  try {
    await act(async () => {});
    expect(view.result.current.ready).toBe(true);
    view.rerender({ enabled: false });
    expect(view.result.current.ready).toBe(false);
    view.rerender({ enabled: true });
    expect(view.result.current.ready).toBe(false);
    await act(async () => next.resolve());
    expect(view.result.current.ready).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
  }
});
