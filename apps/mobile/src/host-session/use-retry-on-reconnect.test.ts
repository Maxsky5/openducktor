import "@openducktor/frontend-core/test-support/dom-environment";
import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useRetryOnReconnect } from "./use-retry-on-reconnect";

test("retries once when the connection opens again, and not while it stays open", () => {
  let retries = 0;
  const retry = () => {
    retries += 1;
  };
  const view = renderHook(({ open }) => useRetryOnReconnect(open, retry), {
    initialProps: { open: true },
  });
  try {
    expect(retries).toBe(0);
    view.rerender({ open: false });
    view.rerender({ open: true });
    expect(retries).toBe(1);
    view.rerender({ open: true });
    expect(retries).toBe(1);
  } finally {
    view.unmount();
  }
});

test("a reconnect without a failed read retries nothing", () => {
  const view = renderHook(({ open }) => useRetryOnReconnect(open, null), {
    initialProps: { open: false },
  });
  view.rerender({ open: true });
  view.unmount();
});
