import { describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { installPanelLayout } from "@/test-utils/panel-layout";
import { createSessionPanelFixture } from "@/test-utils/session-panel-fixtures";
import {
  BottomPanelSplit,
  SessionPanelSplit,
  type SessionPanelSplitIds,
} from "./session-panel-split";
import type { PanelPresence } from "./use-session-panels";

const ids: SessionPanelSplitIds = { group: "test-split", main: "test-main", panel: "test-panel" };
const sizes = { main: 63, mainMin: "35%", panel: 37, panelMin: "30%" };

const renderSplit = (
  presence: PanelPresence,
  onSettled: () => void = () => {},
  direction: "horizontal" | "vertical" = "horizontal",
) => (
  <SessionPanelSplit
    ids={ids}
    model={{ presence, onSettled, onCollapsed: () => {} }}
    direction={direction}
    sizes={sizes}
    separatorLabel="Resize panel"
    className=""
    mainClassName=""
    main={<p>Chat</p>}
    panel={<p>Panel content</p>}
  />
);

const panelElement = (): HTMLElement => {
  const panel = document.querySelector<HTMLElement>(`[id^="${ids.panel}-"]`);
  if (!panel) throw new Error("Expected the panel element.");
  return panel;
};

type Move = { end: () => void };

/** The sheet motion tokens, then the split CSS, as in the app styles. */
const SPLIT_STYLES = [
  new URL("../../components/ui/sheet.css", import.meta.url),
  new URL("./session-panel-split.css", import.meta.url),
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/**
 * Applies the split CSS, which gives a moving panel its size transition. The test DOM runs no
 * transition, so the panel reports a running one until `end` stops it.
 */
const withMove = (run: (move: Move) => void): void => {
  let isRunning = true;
  const transition = new Animation();
  const motionStyle = document.createElement("style");
  motionStyle.textContent = SPLIT_STYLES;
  document.head.append(motionStyle);
  const animations = spyOn(HTMLElement.prototype, "getAnimations").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isRunning && this.matches("[data-panel-motion] > [data-panel]") ? [transition] : [];
  });
  try {
    run({
      end: () => {
        isRunning = false;
      },
    });
  } finally {
    animations.mockRestore();
    motionStyle.remove();
  }
};

/** Runs `run` with laid-out panels and a running move. */
const withLaidOutMove = (run: (move: Move) => void): void => {
  const removePanelLayout = installPanelLayout();
  try {
    withMove(run);
  } finally {
    removePanelLayout();
  }
};

const contentElement = (): HTMLElement => {
  const content = document.querySelector<HTMLElement>('[data-slot="session-panel-content"]');
  if (!content) throw new Error("Expected the panel content.");
  return content;
};

const dispatchMoveEvent = (type: "transitionend" | "transitioncancel"): void => {
  act(() => {
    panelElement().dispatchEvent(new Event(type));
  });
};

describe("SessionPanelSplit", () => {
  test("shows its open size after its view hid during a close and the panel opened", () => {
    withLaidOutMove(() => {
      const inView = (isHidden: boolean, presence: PanelPresence) => (
        <div hidden={isHidden}>{renderSplit(presence, () => {})}</div>
      );
      const view = render(inView(false, "open"));
      view.rerender(inView(false, "closing"));
      // The view hides during the move, so the panel ends its close while hidden.
      view.rerender(inView(true, "closed"));
      // Another view opens the shared right panel.
      view.rerender(inView(true, "open"));
      view.rerender(inView(false, "open"));

      expect(panelElement().style.flexGrow).toBe(String(sizes.panel));
    });
  });

  for (const { direction, key } of [
    { direction: "horizontal", key: "ArrowRight" },
    { direction: "vertical", key: "ArrowDown" },
  ] as const) {
    test(`resizes a ${direction} panel that opened after the split mounted with ${key}`, () => {
      const removePanelLayout = installPanelLayout();
      try {
        const split = (presence: PanelPresence) => renderSplit(presence, () => {}, direction);
        const view = render(split("closed"));
        expect(screen.queryByRole("separator", { name: "Resize panel" })).toBeNull();
        view.rerender(split("open"));
        const separator = screen.getByRole("separator", { name: "Resize panel" });

        act(() => {
          separator.focus();
          fireEvent.keyDown(separator, { key });
        });

        expect(panelElement().style.flexGrow).toBe(String(sizes.panel - 5));
      } finally {
        removePanelLayout();
      }
    });
  }

  for (const { direction, axis, length } of [
    { direction: "horizontal", axis: "width", length: "height" },
    { direction: "vertical", axis: "height", length: "width" },
  ] as const) {
    test(`moves a ${direction} separator only along the split axis, so its grip stays on the axis`, () => {
      const view = render(renderSplit("closed", () => {}, direction));
      const separator = screen.getByRole("separator", { hidden: true });
      const sizesFor = (presence: PanelPresence) => {
        view.rerender(renderSplit(presence, () => {}, direction));
        return { axis: separator.style[axis], length: separator.style[length] };
      };

      // The separator grows from zero size when the panel opens, and shrinks to it on a close.
      expect(sizesFor("closed")).toEqual({ axis: "0px", length: "" });
      expect(sizesFor("opening")).toEqual({ axis: "", length: "" });
      expect(sizesFor("open")).toEqual({ axis: "", length: "" });
      expect(sizesFor("closing")).toEqual({ axis: "0px", length: "" });
    });
  }

  test("ends an open at once when the split is in a hidden view, as no transition runs there", () => {
    withMove(() => {
      const onSettled = mock(() => {});
      // The test DOM has no layout, as a split in a hidden view has no size.
      const inHiddenView = (presence: PanelPresence) => (
        <div hidden>{renderSplit(presence, onSettled)}</div>
      );
      const view = render(inHiddenView("closed"));

      view.rerender(inHiddenView("opening"));

      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test("ends a move at once when no size transition runs, as with reduced motion", () => {
    const onSettled = mock(() => {});
    const view = render(renderSplit("closed", onSettled));
    expect(screen.queryByText("Panel content")).toBeNull();

    view.rerender(renderSplit("opening", onSettled));

    expect(screen.getByText("Panel content")).toBeDefined();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  test("moves the main area and the panel together while the panel opens", () => {
    withLaidOutMove((move) => {
      const onSettled = mock(() => {});
      const view = render(renderSplit("closed", onSettled));

      view.rerender(renderSplit("opening", onSettled));

      expect(panelElement().parentElement?.dataset.panelMotion).toBe("opening");
      expect(panelElement().style.flexGrow).toBe(String(sizes.panel));
      expect(contentElement().dataset.moving).toBe("opening");
      expect(contentElement().hasAttribute("inert")).toBe(false);
      expect(screen.getByRole("separator", { hidden: true }).style.visibility).toBe("");
      expect(onSettled).not.toHaveBeenCalled();

      move.end();
      dispatchMoveEvent("transitionend");

      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test("moves the main area and the panel together while the panel closes", () => {
    withLaidOutMove((move) => {
      const onSettled = mock(() => {});
      const view = render(renderSplit("open", onSettled));

      view.rerender(renderSplit("closing", onSettled));

      expect(panelElement().parentElement?.dataset.panelMotion).toBe("closing");
      expect(panelElement().style.flexGrow).toBe("0");
      expect(contentElement().dataset.moving).toBe("closing");
      expect(contentElement().hasAttribute("inert")).toBe(true);
      // The separator stays with the panel edge, but a moving panel does not resize.
      const separator = screen.getByRole("separator", { hidden: true });
      expect(separator.style.visibility).toBe("");
      expect(separator.getAttribute("aria-disabled")).toBe("true");
      expect(onSettled).not.toHaveBeenCalled();

      move.end();
      dispatchMoveEvent("transitionend");
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test("waits for the reversed move when the panel opens again during its close", () => {
    withLaidOutMove((move) => {
      const onSettled = mock(() => {});
      const view = render(renderSplit("open", onSettled));
      view.rerender(renderSplit("closing", onSettled));

      view.rerender(renderSplit("opening", onSettled));
      // The open replaces the close transition, so the close transition reports a cancel.
      dispatchMoveEvent("transitioncancel");

      expect(contentElement().dataset.moving).toBe("opening");
      expect(panelElement().style.flexGrow).toBe(String(sizes.panel));
      expect(onSettled).not.toHaveBeenCalled();

      move.end();
      dispatchMoveEvent("transitionend");
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test("ends a hide at once when a drag already made the panel zero wide", () => {
    withMove(() => {
      const onSettled = mock(() => {});
      // The test DOM has no layout, so the panel is zero wide.
      const view = render(renderSplit("open", onSettled));

      view.rerender(renderSplit("closing", onSettled));

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(contentElement().hasAttribute("inert")).toBe(true);
    });
  });

  test("shows and hides a panel at once without the move", () => {
    const onSettled = mock(() => {});
    const view = render(renderSplit("closed", onSettled));
    expect(screen.queryByText("Panel content")).toBeNull();

    view.rerender(renderSplit("open", onSettled));

    expect(contentElement().dataset.moving).toBeUndefined();
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
        <ClientConnectionProvider connection={createTestClientConnection()}>
          <BottomPanelSplit ids={ids} model={bottom} className="" mainClassName="">
            <p>Chat content</p>
          </BottomPanelSplit>
        </ClientConnectionProvider>,
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
