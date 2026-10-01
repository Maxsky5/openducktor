import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useVisibleSessionId } from "./use-visible-session-id";

test.each(["discard", "keep"])(
  "the latest session choice wins when the user chooses %s",
  (choice) => {
    const transitions: Array<{ apply: () => void; cancel?: () => void }> = [];
    const guard: Parameters<typeof useVisibleSessionId>[1] = (apply, cancel) => {
      transitions.at(-1)?.cancel?.();
      const transition: (typeof transitions)[number] = { apply };
      if (cancel) transition.cancel = cancel;
      transitions.push(transition);
    };
    const updateNavigation = mock(() => {});
    const cancelPending = mock(() => {});
    const view = renderHook(
      ({ requested }) => useVisibleSessionId(requested, guard, updateNavigation, cancelPending),
      { initialProps: { requested: "A" } },
    );
    try {
      view.rerender({ requested: "B" });
      view.rerender({ requested: "C" });
      expect(updateNavigation).not.toHaveBeenCalled();
      expect(view.result.current.visibleSelectedId).toBe("A");

      act(() => {
        const latest = transitions.at(-1);
        if (choice === "discard") latest?.apply();
        else latest?.cancel?.();
      });
      if (choice === "discard") {
        expect(view.result.current.visibleSelectedId).toBe("C");
        expect(updateNavigation).not.toHaveBeenCalled();
      } else {
        expect(view.result.current.visibleSelectedId).toBe("A");
        expect(updateNavigation).toHaveBeenCalledWith({ sessionId: "A" });
      }
    } finally {
      view.unmount();
    }
  },
);

test("returning to the open session drops a pending choice", () => {
  let applyPending: (() => void) | undefined;
  const guard: Parameters<typeof useVisibleSessionId>[1] = (apply) => {
    applyPending = apply;
  };
  const updateNavigation = mock(() => {});
  const cancelPending = mock(() => {});
  const view = renderHook(
    ({ requested }) => useVisibleSessionId(requested, guard, updateNavigation, cancelPending),
    { initialProps: { requested: "A" } },
  );
  try {
    view.rerender({ requested: "B" });
    view.rerender({ requested: "A" });
    act(() => applyPending?.());
    expect(view.result.current.visibleSelectedId).toBe("A");
    expect(updateNavigation).not.toHaveBeenCalled();
    expect(cancelPending).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});

test("a canceled fallback waits until the user chooses the session again", () => {
  const transitions: Array<{ apply: () => void; cancel?: () => void }> = [];
  const guard: Parameters<typeof useVisibleSessionId>[1] = (apply, cancel) => {
    const transition: (typeof transitions)[number] = { apply };
    if (cancel) transition.cancel = cancel;
    transitions.push(transition);
  };
  const updateNavigation = mock(() => {});
  const view = renderHook(
    ({ requested }) => useVisibleSessionId(requested, guard, updateNavigation, () => {}),
    { initialProps: { requested: "A" } },
  );
  try {
    view.rerender({ requested: "B" });
    expect(transitions).toHaveLength(1);
    act(() => transitions[0]?.cancel?.());
    view.rerender({ requested: "B" });
    expect(transitions).toHaveLength(1);
    expect(view.result.current.visibleSelectedId).toBe("A");

    view.rerender({ requested: "A" });
    view.rerender({ requested: "B" });
    expect(transitions).toHaveLength(2);
    act(() => transitions[1]?.apply());
    expect(view.result.current.visibleSelectedId).toBe("B");
  } finally {
    view.unmount();
  }
});
