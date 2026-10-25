import { expect, jest, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { useMinimumLoading } from "./use-minimum-loading";

enableReactActEnvironment();

function Harness({ isLoading }: { isLoading: boolean }): ReactElement {
  const shown = useMinimumLoading(isLoading, 500);
  return createElement("output", { "data-loading": String(shown) });
}

test("keeps the loader for its minimum time after fast work ends", () => {
  jest.useFakeTimers();
  try {
    const view = render(createElement(Harness, { isLoading: true }));
    const shown = () => view.container.querySelector("output")?.getAttribute("data-loading");
    try {
      expect(shown()).toBe("true");
      act(() => jest.advanceTimersByTime(100));
      view.rerender(createElement(Harness, { isLoading: false }));
      expect(shown()).toBe("true");
      act(() => jest.advanceTimersByTime(399));
      expect(shown()).toBe("true");
      act(() => jest.advanceTimersByTime(1));
      expect(shown()).toBe("false");

      // Slow work ends after the minimum time, so the loader goes at once.
      view.rerender(createElement(Harness, { isLoading: true }));
      expect(shown()).toBe("true");
      act(() => jest.advanceTimersByTime(800));
      view.rerender(createElement(Harness, { isLoading: false }));
      expect(shown()).toBe("false");
    } finally {
      view.unmount();
    }
  } finally {
    jest.useRealTimers();
  }
});
