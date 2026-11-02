import { describe, expect, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import { ToastResizeContent } from "./toast-resize";

const originalResizeObserver = globalThis.ResizeObserver;
const restoreSpies: (() => void)[] = [];

/** Runs a test and removes its tree, globals, and spies after the test body ends. */
const toastTest = (name: string, body: () => void) =>
  test(name, () => {
    const endBody = restoreAfterTestBody(() => {
      cleanup();
      globalThis.ResizeObserver = originalResizeObserver;
      for (const restore of restoreSpies.splice(0)) restore();
    });
    try {
      body();
    } finally {
      endBody();
    }
  });

function installResizeObserver(): () => void {
  let notify = () => {};
  globalThis.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  return () => notify();
}

/** Sonner moves the toast stack with a transform transition. */
const sonnerTransition = {
  transitionProperty: "opacity, transform",
  transitionDuration: "0.2s, 0.4s",
  transitionTimingFunction: "linear, cubic-bezier(0.25, 0.1, 0.25, 1)",
} satisfies CSSProperties;

type ToastLayout = { natural: number; visible: number | null };

/** Fakes the toast layout. A running animation sets the visible height. */
function fakeToastLayout(height: number) {
  const layout: ToastLayout = { natural: height, visible: null };
  const measure = spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 360, layout.visible ?? layout.natural),
  );
  const animations: { keyframes: Parameters<HTMLElement["animate"]>[0]; animation: Animation }[] =
    [];
  const animate = spyOn(HTMLElement.prototype, "animate").mockImplementation((keyframes) => {
    const animation = new Animation();
    Object.defineProperty(animation, "currentTime", { value: 0, writable: true });
    Object.defineProperty(animation, "startTime", { value: null, writable: true });
    spyOn(animation, "cancel").mockImplementation(() => {
      layout.visible = null;
    });
    spyOn(animation, "pause").mockImplementation(() => {});
    animations.push({ keyframes, animation });
    return animation;
  });
  const frames: FrameRequestCallback[] = [];
  const frame = spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  restoreSpies.push(
    () => measure.mockRestore(),
    () => animate.mockRestore(),
    () => frame.mockRestore(),
  );
  return { layout, animate, animations, frames };
}

/** Reads the toast height in a parent layout effect, like Sonner. */
function SonnerMeasure({
  children,
  onMeasure,
}: {
  children: ReactNode;
  onMeasure: (height: number) => void;
}): ReactElement {
  const toast = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (toast.current) onMeasure(toast.current.getBoundingClientRect().height);
  });
  return (
    <li ref={toast} data-sonner-toast="" style={sonnerTransition}>
      {children}
    </li>
  );
}

/** A Sonner toast with resizing content. */
const toastElement = ({
  label = "Steps",
  onResize = () => {},
  onMeasure = () => {},
}: {
  label?: string;
  onResize?: (height: number) => void;
  onMeasure?: (height: number) => void;
} = {}) => (
  <SonnerMeasure onMeasure={onMeasure}>
    <ToastResizeContent onResize={onResize}>{label}</ToastResizeContent>
  </SonnerMeasure>
);

describe("ToastResizeContent", () => {
  toastTest("animates the toast height with the transition that moves the toast stack", () => {
    const notifyResize = installResizeObserver();
    const { layout, animate } = fakeToastLayout(120);
    const heights: number[] = [];

    render(toastElement({ onResize: (height) => heights.push(height) }));
    layout.natural = 260;
    notifyResize();

    expect(animate).toHaveBeenCalledWith(
      [
        { height: "120px", overflow: "hidden" },
        { height: "260px", overflow: "hidden" },
      ],
      { duration: 400, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    );
    expect(heights).toEqual([260]);
  });

  toastTest("resizes at once when Sonner moves the stack without a transition", () => {
    const notifyResize = installResizeObserver();
    const { layout, animate } = fakeToastLayout(120);
    const view = render(toastElement());
    view.container.querySelector<HTMLElement>("[data-sonner-toast]")!.style.transitionProperty =
      "none";
    layout.natural = 260;
    notifyResize();

    expect(animate).not.toHaveBeenCalled();
  });

  toastTest("shortens a reversed resize like the CSS transition of the stack", () => {
    const notifyResize = installResizeObserver();
    const { layout, animate } = fakeToastLayout(120);
    render(toastElement());
    layout.natural = 260;
    notifyResize();
    layout.visible = 190;
    layout.natural = 120;
    notifyResize();

    expect(animate).toHaveBeenLastCalledWith(
      [
        { height: "190px", overflow: "hidden" },
        { height: "120px", overflow: "hidden" },
      ],
      { duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    );
  });

  toastTest("keeps a content-driven resize at its start until Sonner moves the stack", () => {
    const notifyResize = installResizeObserver();
    const { layout, animations, frames } = fakeToastLayout(120);
    render(toastElement());
    frames.splice(0);
    layout.natural = 260;
    notifyResize();
    const [first] = animations;
    layout.visible = 120;

    expect(first!.animation.pause).toHaveBeenCalled();
    frames.at(-1)!(0);
    expect(animations).toHaveLength(2);
    expect(animations[1]!.keyframes).toEqual(first!.keyframes);
    expect(animations[1]!.animation.currentTime).toBe(0);
    expect(animations[1]!.animation.pause).not.toHaveBeenCalled();
  });

  toastTest("continues a running resize from its timeline start after a toast update", () => {
    installResizeObserver();
    const { layout, animations, frames } = fakeToastLayout(120);
    let now = 1000;
    Object.defineProperty(document.timeline, "currentTime", {
      configurable: true,
      get: () => now,
    });
    restoreSpies.push(() => Reflect.deleteProperty(document.timeline, "currentTime"));
    const view = render(toastElement({ label: "Create worktree" }));
    layout.natural = 260;
    view.rerender(toastElement({ label: "Copy configured files" }));
    frames.at(-1)!(0);
    const [first] = animations;
    layout.visible = 170;
    now = 1016;

    view.rerender(toastElement({ label: "Run setup" }));
    frames.at(-1)!(0);

    expect(animations).toHaveLength(2);
    expect(animations[1]!.keyframes).toEqual(first!.keyframes);
    expect(animations[1]!.animation.startTime).toBe(1000);
  });

  toastTest("gives Sonner the natural height of a toast in motion", () => {
    const notifyResize = installResizeObserver();
    const { layout, animations, frames } = fakeToastLayout(120);
    const measured: number[] = [];
    const onMeasure = (height: number) => measured.push(height);
    const view = render(toastElement({ label: "Create worktree", onMeasure }));
    layout.natural = 260;
    notifyResize();
    const [first] = animations;
    layout.visible = 120;

    view.rerender(toastElement({ label: "Copy configured files", onMeasure }));
    expect(measured.at(-1)).toBe(260);
    frames.at(-1)!(0);

    expect(animations).toHaveLength(2);
    expect(animations[1]!.keyframes).toEqual(first!.keyframes);
  });
});
