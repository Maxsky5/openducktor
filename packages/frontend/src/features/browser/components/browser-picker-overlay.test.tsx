import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrowserPickerOverlay, type BrowserPickerOverlayProps } from "./browser-picker-overlay";

type FrameCallback = (time: number) => void;

let frames: Map<number, FrameCallback>;
let nextFrameId: number;
let restoreFrames: () => void = () => {};

const runFrames = (): void => {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of callbacks) callback(0);
  });
};

beforeEach(() => {
  frames = new Map();
  nextFrameId = 1;
  const request = spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback: FrameCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    },
  );
  const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id: number) => {
    frames.delete(id);
  });
  restoreFrames = () => {
    request.mockRestore();
    cancel.mockRestore();
  };
});

afterEach(() => {
  restoreFrames();
});

const renderOverlay = (overrides: Partial<BrowserPickerOverlayProps> = {}) => {
  const props: BrowserPickerOverlayProps = {
    target: null,
    selected: [],
    onPointerMove: mock((_x: number, _y: number) => {}),
    onPick: mock((_shiftKey: boolean, _x: number, _y: number) => {}),
    onCancel: mock(() => {}),
    ...overrides,
  };
  const view = render(<BrowserPickerOverlay {...props} />);
  const overlay = screen.getByTestId("browser-picker-overlay");
  spyOn(overlay, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 800, 600));
  return { props, view, overlay };
};

describe("BrowserPickerOverlay", () => {
  test("takes keyboard focus and sends the pointer position at most once per frame", () => {
    const { props, overlay } = renderOverlay();
    expect(document.activeElement).toBe(overlay);

    fireEvent.pointerMove(overlay, { clientX: 110, clientY: 60 });
    fireEvent.pointerMove(overlay, { clientX: 130, clientY: 90 });
    expect(props.onPointerMove).not.toHaveBeenCalled();
    runFrames();
    fireEvent.pointerMove(overlay, { clientX: 150, clientY: 100 });
    runFrames();

    expect(props.onPointerMove).toHaveBeenCalledTimes(2);
    expect(props.onPointerMove).toHaveBeenNthCalledWith(1, 30, 40);
    expect(props.onPointerMove).toHaveBeenNthCalledWith(2, 50, 50);
  });

  test("picks at the click point, adds with Shift-click, and turns off on Escape", () => {
    const { props, overlay } = renderOverlay();

    fireEvent.click(overlay, { clientX: 130, clientY: 90 });
    fireEvent.click(overlay, { clientX: 150, clientY: 100, shiftKey: true });
    fireEvent.keyDown(overlay, { key: "Escape" });

    expect(props.onPick).toHaveBeenNthCalledWith(1, false, 30, 40);
    expect(props.onPick).toHaveBeenNthCalledWith(2, true, 50, 50);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("draws the highlight with its label and outlines the selected elements", () => {
    renderOverlay({
      target: { box: { x: 12, y: 40, width: 200, height: 30 }, label: "SaveButton" },
      selected: [
        { x: 0, y: 0, width: 50, height: 20 },
        { x: 10, y: 100, width: 60, height: 20 },
      ],
    });

    const target = screen.getByTestId("browser-picker-target");
    expect(target.textContent).toBe("SaveButton");
    expect(target.style.left).toBe("12px");
    expect(target.style.top).toBe("40px");
    expect(target.style.width).toBe("200px");
    expect(screen.getAllByTestId("browser-picker-selected")).toHaveLength(2);
  });

  test("cancels a waiting frame when it closes", () => {
    const { props, overlay, view } = renderOverlay();

    fireEvent.pointerMove(overlay, { clientX: 110, clientY: 60 });
    view.unmount();
    runFrames();

    expect(props.onPointerMove).not.toHaveBeenCalled();
  });
});
