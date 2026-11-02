import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useModalPresence } from "./use-modal-presence";

describe("useModalPresence", () => {
  test("opens at once and keeps the window until its exit finishes", () => {
    let dismissed = 0;
    const onDismiss = () => dismissed++;
    const { result, rerender } = renderHook(
      ({ visible }) => useModalPresence(visible, { onDismiss }),
      { initialProps: { visible: false } },
    );
    expect(result.current.mounted).toBe(false);

    rerender({ visible: true });
    expect(result.current.mounted).toBe(true);
    const cycle = result.current.cycle;

    rerender({ visible: false });
    expect(result.current.mounted).toBe(true);
    expect(dismissed).toBe(0);
    act(() => {
      result.current.exited(cycle);
      result.current.exited(cycle);
    });
    expect(result.current.mounted).toBe(false);
    expect(dismissed).toBe(1);
  });

  test("keeps a reopened window when an older exit finishes", () => {
    let dismissed = 0;
    const { result, rerender } = renderHook(
      ({ visible }) => useModalPresence(visible, { onDismiss: () => dismissed++ }),
      { initialProps: { visible: true } },
    );
    const oldCycle = result.current.cycle;
    rerender({ visible: false });
    rerender({ visible: true });
    act(() => result.current.exited(oldCycle));
    expect(result.current.mounted).toBe(true);

    const cycle = result.current.cycle;
    rerender({ visible: false });
    act(() => result.current.exited(oldCycle));
    expect(result.current.mounted).toBe(true);
    expect(dismissed).toBe(0);
    act(() => result.current.exited(cycle));
    expect(result.current.mounted).toBe(false);
    expect(dismissed).toBe(1);
  });

  test("notifies the current caller after entry and skips canceled entry", () => {
    const shown: string[] = [];
    const { result, rerender } = renderHook(
      ({ visible, caller }) => useModalPresence(visible, { onShow: () => shown.push(caller) }),
      { initialProps: { visible: true, caller: "first" } },
    );
    const cycle = result.current.cycle;
    rerender({ visible: true, caller: "current" });
    act(() => result.current.entered(cycle));
    expect(shown).toEqual(["current"]);
    rerender({ visible: false, caller: "current" });
    act(() => result.current.entered(cycle));
    expect(shown).toEqual(["current"]);
  });
});
