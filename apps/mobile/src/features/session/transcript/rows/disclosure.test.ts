import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  createDisclosureStore,
  DisclosureStoreProvider,
  RowLayoutProvider,
  useDisclosure,
} from "./disclosure";

const renderDisclosure = (
  defaultOpen: boolean,
  key = "row-1",
  store = createDisclosureStore(),
  layoutRow: (() => void) | null = null,
) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      DisclosureStoreProvider,
      { value: store },
      createElement(RowLayoutProvider, { value: layoutRow }, children),
    );
  return renderHook(
    (props: { defaultOpen: boolean; key: string }) => useDisclosure(props.defaultOpen, props.key),
    { initialProps: { defaultOpen, key }, wrapper },
  );
};

describe("useDisclosure", () => {
  test("opens a live file edit when its diff arrives and diffs open by default", () => {
    // A running edit has only a path, so it has no content to open.
    const { result, rerender } = renderDisclosure(false);
    expect(result.current.open).toBe(false);
    rerender({ defaultOpen: true, key: "row-1" });
    expect(result.current).toMatchObject({ open: true, pressed: false });
  });

  test("keeps the reader's choice when the default changes", () => {
    const { result, rerender } = renderDisclosure(true);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: false, pressed: true });
    rerender({ defaultOpen: false, key: "row-1" });
    rerender({ defaultOpen: true, key: "row-1" });
    expect(result.current.open).toBe(false);
  });

  test("keeps a choice for each part when a view shows another part and comes back", () => {
    const { result, rerender } = renderDisclosure(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    // The list reuses the view for another row.
    rerender({ defaultOpen: false, key: "row-2" });
    expect(result.current).toMatchObject({ open: false, pressed: false });
    rerender({ defaultOpen: false, key: "row-1" });
    expect(result.current).toMatchObject({ open: true, pressed: true });
  });

  test("measures the list row again on a press only", () => {
    let layouts = 0;
    const { result, rerender } = renderDisclosure(false, "row-1", createDisclosureStore(), () => {
      layouts += 1;
    });
    rerender({ defaultOpen: true, key: "row-1" });
    expect(layouts).toBe(0);
    act(() => result.current.toggle());
    expect(layouts).toBe(1);
  });

  test("keeps a choice when the view of the part mounts again", () => {
    const store = createDisclosureStore();
    const first = renderDisclosure(false, "row-1", store);
    act(() => first.result.current.toggle());
    first.unmount();
    expect(renderDisclosure(false, "row-1", store).result.current.open).toBe(true);
  });
});
