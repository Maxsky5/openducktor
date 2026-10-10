import { describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createSessionPanelFixture } from "@/test-utils/session-panel-fixtures";
import {
  BottomPanelSplit,
  SessionPanelSplit,
  type SessionPanelSplitIds,
} from "./session-panel-split";
import type { PanelPresence } from "./use-session-panels";

const ids: SessionPanelSplitIds = { group: "test-split", main: "test-main", panel: "test-panel" };
const sizes = { main: 63, mainMin: "35%", panel: 37, panelMin: "30%" };

const renderSplit = (presence: PanelPresence, onSettled: () => void, onCollapsed = () => {}) => (
  <SessionPanelSplit
    ids={ids}
    model={{ presence, onSettled, onCollapsed }}
    direction="horizontal"
    sizes={sizes}
    className=""
    mainClassName=""
    main={<p>Chat</p>}
    panel={<p>Panel content</p>}
  />
);

const panelElement = (): HTMLElement => {
  const panel = document.getElementById(ids.panel);
  if (!panel) throw new Error("Expected the panel element.");
  return panel;
};

/** Gives the panel a size transition, as the split CSS does during a move. */
const withSizeTransition = (run: () => void): void => {
  // SAFETY: the split reads only `transitionDuration` from the computed style.
  const style = spyOn(window, "getComputedStyle").mockReturnValue({
    transitionDuration: "0.2s",
  } as CSSStyleDeclaration);
  try {
    run();
  } finally {
    style.mockRestore();
  }
};

describe("SessionPanelSplit", () => {
  test("ends a move at once when no size transition runs, as with reduced motion", () => {
    const onSettled = mock(() => {});
    const view = render(renderSplit("closed", onSettled));
    expect(screen.queryByText("Panel content")).toBeNull();

    view.rerender(renderSplit("opening", onSettled));

    expect(screen.getByText("Panel content")).toBeDefined();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  test("moves the main area and the panel together until the size transition ends", () => {
    withSizeTransition(() => {
      const onSettled = mock(() => {});
      const view = render(renderSplit("closed", onSettled));

      view.rerender(renderSplit("opening", onSettled));

      const group = panelElement().parentElement;
      const content = screen.getByText("Panel content").parentElement;
      expect(group?.dataset.panelMotion).toBe("opening");
      expect(content?.dataset.moving).toBe("opening");
      expect(content?.hasAttribute("inert")).toBe(false);
      expect(onSettled).not.toHaveBeenCalled();

      act(() => {
        panelElement().dispatchEvent(new Event("transitionend"));
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test("ends a hide at once when a drag already made the panel zero wide", () => {
    withSizeTransition(() => {
      const onSettled = mock(() => {});
      // The test DOM has no layout, so the panel is zero wide.
      const view = render(renderSplit("open", onSettled));

      view.rerender(renderSplit("closing", onSettled));

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Panel content").parentElement?.hasAttribute("inert")).toBe(true);
    });
  });

  test("shows and hides a panel at once without the slide motion", () => {
    const onSettled = mock(() => {});
    const view = render(renderSplit("closed", onSettled));
    expect(screen.queryByText("Panel content")).toBeNull();

    view.rerender(renderSplit("open", onSettled));

    expect(panelElement().parentElement?.dataset.panelMotion).toBeUndefined();
    expect(screen.getByRole("separator")).toBeDefined();
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("BottomPanelSplit", () => {
  test("fills a narrow window with the bottom panel, and Back returns to the session", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    let hidden = false;
    const bottom = createSessionPanelFixture({
      panel: "bottom",
      tabs: [],
      selectedTabId: null,
      onHide: () => {
        hidden = true;
      },
    });
    try {
      const view = render(
        <BottomPanelSplit ids={ids} model={bottom} className="" mainClassName="">
          <p>Chat content</p>
        </BottomPanelSplit>,
      );
      expect(view.getByText("Chat content").parentElement?.hidden).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Back to workspace" }));
      expect(hidden).toBe(true);
      view.unmount();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
