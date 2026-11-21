import { expect, mock, test } from "bun:test";
import { fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { FloatingWindow, FloatingWindowLayer, type FloatingWindowRect } from "./floating-window";

const START: FloatingWindowRect = { x: 100, y: 100, width: 400, height: 300 };

function Harness({
  onRectChange,
  onClose,
}: {
  onRectChange: (rect: FloatingWindowRect) => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState(START);
  return (
    <FloatingWindowLayer>
      <FloatingWindow
        id="test"
        title="Test window"
        actions={<button type="button">Attach</button>}
        onClose={onClose}
        rect={rect}
        onRectChange={(next) => {
          setRect(next);
          onRectChange(next);
        }}
      >
        <input aria-label="Search" />
      </FloatingWindow>
    </FloatingWindowLayer>
  );
}

const mount = () => {
  const onRectChange = mock((_rect: FloatingWindowRect) => {});
  const onClose = mock(() => {});
  const view = render(<Harness onRectChange={onRectChange} onClose={onClose} />);
  const windowElement = view.getByRole("dialog", { name: "Test window" });
  return { view, onRectChange, onClose, windowElement };
};

/** Drags an element by a distance with the main button. */
const drag = (element: Element, dx: number, dy: number) => {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
  fireEvent.pointerUp(element, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
};

test("floats without blocking the app", () => {
  const { windowElement } = mount();
  // An open native dialog that is not modal takes no focus and leaves the page usable.
  expect(windowElement.tagName).toBe("DIALOG");
  expect(windowElement.hasAttribute("open")).toBe(true);
  expect(windowElement.getAttribute("aria-modal")).not.toBe("true");
});

test("moves by its title bar and gives the owner the new place", () => {
  const { view, onRectChange } = mount();
  drag(view.getByText("Test window"), 40, 30);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 140, y: 130, width: 400, height: 300 });
});

test("keeps the clicks of its buttons and never moves from its content", () => {
  const { windowElement, onRectChange, onClose } = mount();
  drag(within(windowElement).getByRole("button", { name: "Attach" }), 40, 30);
  drag(within(windowElement).getByRole("textbox", { name: "Search" }), 40, 30);
  expect(onRectChange).not.toHaveBeenCalledWith(expect.objectContaining({ x: 140 }));
  within(windowElement).getByRole("button", { name: "Close Test window" }).click();
  expect(onClose).toHaveBeenCalled();
});

const handle = (windowElement: HTMLElement, name: string): Element => {
  const element = windowElement.querySelector(`[data-resize-handle="${name}"]`);
  if (!element) throw new Error(`The ${name} resize handle is missing.`);
  return element;
};

test("resizes from its bottom right corner, not smaller than its minimum size", () => {
  const { windowElement, onRectChange } = mount();
  const corner = handle(windowElement, "se");
  drag(corner, 50, 20);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 100, y: 100, width: 450, height: 320 });
  drag(corner, -400, -400);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 100, y: 100, width: 360, height: 240 });
});

test("resizes from the top left corner and keeps the opposite edges in place", () => {
  const { windowElement, onRectChange } = mount();
  const corner = handle(windowElement, "nw");
  drag(corner, -40, -30);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 60, y: 70, width: 440, height: 330 });
  // The minimum size stops the edges, and the right and bottom edges stay at 500 and 400.
  drag(corner, 400, 400);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 140, y: 160, width: 360, height: 240 });
  // The edges stay inside the viewport.
  drag(corner, -5_000, -5_000);
  expect(onRectChange).toHaveBeenLastCalledWith({ x: 8, y: 8, width: 492, height: 392 });
});

test("resizes from each edge and from the other corners", () => {
  const { windowElement, onRectChange } = mount();
  const resize = (name: string, dx: number, dy: number) => {
    drag(handle(windowElement, name), dx, dy);
    return onRectChange.mock.calls.at(-1)?.[0];
  };
  expect(resize("w", -20, 50)).toEqual({ x: 80, y: 100, width: 420, height: 300 });
  expect(resize("n", 50, -20)).toEqual({ x: 80, y: 80, width: 420, height: 320 });
  expect(resize("e", 30, 50)).toEqual({ x: 80, y: 80, width: 450, height: 320 });
  expect(resize("s", 50, 30)).toEqual({ x: 80, y: 80, width: 450, height: 350 });
  expect(resize("ne", 10, -10)).toEqual({ x: 80, y: 70, width: 460, height: 360 });
  expect(resize("sw", -10, 10)).toEqual({ x: 70, y: 70, width: 470, height: 370 });
});

test("keeps its title bar inside the viewport", () => {
  const { view, onRectChange } = mount();
  drag(view.getByText("Test window"), -5_000, -5_000);
  const last = onRectChange.mock.calls.at(-1)?.[0];
  expect(last?.y).toBe(8);
  expect((last?.x ?? 0) + (last?.width ?? 0)).toBeGreaterThanOrEqual(96);
});
