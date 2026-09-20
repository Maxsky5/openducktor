import { describe, expect, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import { StudioTabStrip, StudioTabsList, StudioTabTrigger } from "./studio-tab-strip";

function setupStrip(
  initialValue: string,
  initialIds = ["first", "middle", "last"],
  initialScroll = 0,
) {
  let viewport: HTMLDivElement;
  const positions = new Map<string, [number, number]>([
    ["first", [0, 80]],
    ["middle", [100, 80]],
    ["last", [300, 80]],
    ["wide", [300, 300]],
  ]);
  const setViewport = (node: HTMLDivElement | null) => {
    if (!node) return;
    viewport = node;
    viewport.scrollLeft = initialScroll;
    viewport.scrollTop = 12;
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 200 });
    viewport.getBoundingClientRect = () => new DOMRect(50, 20, 200, 40);
  };
  const tree = (value: string, ids: string[]) => (
    <Tabs value={value}>
      <StudioTabStrip scrollRef={setViewport} createAction={<button type="button">New tab</button>}>
        <StudioTabsList>
          {ids.map((id) => (
            <div key={id}>
              <StudioTabTrigger
                value={id}
                ref={(node) => {
                  if (!node) return;
                  node.getBoundingClientRect = () => {
                    const [left, width] = positions.get(id)!;
                    return new DOMRect(50 + left - viewport.scrollLeft, 20, width, 32);
                  };
                }}
              >
                {id}
              </StudioTabTrigger>
            </div>
          ))}
        </StudioTabsList>
      </StudioTabStrip>
    </Tabs>
  );
  const view = render(tree(initialValue, initialIds));
  return {
    ...view,
    viewport: viewport!,
    select: (value: string, ids = initialIds) => view.rerender(tree(value, ids)),
  };
}

describe("StudioTabStrip active tab visibility", () => {
  test("reveals the initial active tab without moving vertically or taking focus", () => {
    const focused = document.activeElement;
    const view = setupStrip("last");
    expect(view.viewport.scrollLeft).toBe(180);
    expect(view.viewport.scrollTop).toBe(12);
    expect(document.activeElement).toBe(focused);
    view.unmount();
  });

  test("reveals controlled selection changes in either direction", async () => {
    const view = setupStrip("first");
    try {
      view.select("last");
      await waitFor(() => expect(view.viewport.scrollLeft).toBe(180));
      view.select("first");
      await waitFor(() => expect(view.viewport.scrollLeft).toBe(0));
    } finally {
      view.unmount();
    }
  });

  test("reveals a restored tab when its selected value precedes its insertion", async () => {
    const view = setupStrip("last", ["first", "middle"]);
    try {
      expect(view.viewport.scrollLeft).toBe(0);
      view.select("last", ["first", "middle", "last"]);
      await waitFor(() => expect(view.viewport.scrollLeft).toBe(180));
    } finally {
      view.unmount();
    }
  });

  test("keeps the scroll position when the selected tab is fully visible", async () => {
    const view = setupStrip("middle", undefined, 40);
    try {
      expect(view.viewport.scrollLeft).toBe(40);
      await act(async () => view.select("missing"));
      await act(async () => view.select("middle"));
      expect(view.viewport.scrollLeft).toBe(40);
    } finally {
      view.unmount();
    }
  });

  test("reveals a partially clipped tab by only the required distance", () => {
    const view = setupStrip("first", undefined, 30);
    expect(view.viewport.scrollLeft).toBe(0);
    view.unmount();
  });

  test("aligns an oversized tab once without oscillating between its edges", async () => {
    const view = setupStrip("wide", ["first", "wide"]);
    try {
      expect(view.viewport.scrollLeft).toBe(300);
      await act(async () => view.select("missing"));
      await act(async () => view.select("wide"));
      expect(view.viewport.scrollLeft).toBe(300);
    } finally {
      view.unmount();
    }
  });

  test("disconnects the selection observer on unmount", async () => {
    const view = setupStrip("first");
    const last = view.getByRole("tab", { name: "last" });
    const first = view.getByRole("tab", { name: "first" });
    view.unmount();
    await act(async () => {
      first.setAttribute("data-state", "inactive");
      last.setAttribute("data-state", "active");
    });
    expect(view.viewport.scrollLeft).toBe(0);
  });
});
