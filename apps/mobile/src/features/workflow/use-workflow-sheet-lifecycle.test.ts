import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useWorkflowSheetLifecycle } from "./use-workflow-sheet-lifecycle";

/** A sheet whose action opens a step when `opens` is true, as a start opens its choices. */
const renderSheet = ({ ready, opens }: { ready: boolean; opens: boolean }) => {
  const calls = { run: 0, close: 0 };
  const close = () => {
    calls.close += 1;
  };
  const hook = renderHook(
    ({ isReady }: { isReady: boolean }) => {
      const [open, setOpen] = useState(false);
      const triggered = useWorkflowSheetLifecycle({
        ready: isReady,
        run: () => {
          calls.run += 1;
          if (opens) setOpen(true);
        },
        anyOpen: open,
        close,
      });
      return { triggered, setOpen };
    },
    { initialProps: { isReady: ready } },
  );
  return { calls, ...hook };
};

describe("useWorkflowSheetLifecycle", () => {
  test("waits until it is ready, then runs the action once", () => {
    const { calls, result, rerender } = renderSheet({ ready: false, opens: true });
    expect(calls).toEqual({ run: 0, close: 0 });
    expect(result.current.triggered).toBe(false);

    rerender({ isReady: true });
    rerender({ isReady: true });

    expect(calls).toEqual({ run: 1, close: 0 });
    expect(result.current.triggered).toBe(true);
  });

  test("stays open while the step is open, then closes once when it closes", () => {
    const { calls, result } = renderSheet({ ready: true, opens: true });
    expect(calls).toEqual({ run: 1, close: 0 });

    act(() => result.current.setOpen(false));

    expect(calls).toEqual({ run: 1, close: 1 });
  });

  test("closes once when the action fails before a step opens", () => {
    const { calls, rerender } = renderSheet({ ready: true, opens: false });
    rerender({ isReady: true });

    expect(calls).toEqual({ run: 1, close: 1 });
  });
});
