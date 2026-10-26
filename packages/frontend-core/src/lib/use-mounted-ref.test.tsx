import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { useMountedRef } from "./use-mounted-ref";

test("keeps one mounted ref through rerenders and clears it on unmount in StrictMode", () => {
  const view = renderHook(useMountedRef, {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  const mounted = view.result.current;
  try {
    expect(mounted.current).toBe(true);
    view.rerender();
    expect(view.result.current).toBe(mounted);
    expect(mounted.current).toBe(true);
  } finally {
    view.unmount();
  }
  expect(mounted.current).toBe(false);

  const replacement = renderHook(useMountedRef);
  try {
    expect(replacement.result.current).not.toBe(mounted);
    expect(replacement.result.current.current).toBe(true);
    expect(mounted.current).toBe(false);
  } finally {
    replacement.unmount();
  }
});
