import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "./dialog";

const originalResizeObserver = globalThis.ResizeObserver;

function installResizeObserver(): (width: number, height: number) => void {
  let notifyResize: ((width: number, height: number) => void) | undefined;
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;
    private target: Element | null = null;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      notifyResize = (width, height) => {
        if (!this.target) return;
        this.callback(
          [
            {
              target: this.target,
              borderBoxSize: [{ inlineSize: width, blockSize: height }],
              contentBoxSize: [],
              contentRect: new DOMRect(0, 0, width, height),
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      };
    }

    observe(target: Element) {
      this.target = target;
    }

    unobserve() {}
    disconnect() {}
  };

  return (width, height) => notifyResize?.(width, height);
}

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe("DialogContent", () => {
  test("keeps the closing surface mounted and reuses it when reopened", () => {
    const nativeGetComputedStyle = globalThis.getComputedStyle;
    const computedStyle = spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
      const style = nativeGetComputedStyle(element);
      const slot = element.getAttribute("data-slot");
      if (slot === "dialog-content" || slot === "dialog-positioner") {
        return Object.create(style, {
          animationName: {
            get: () => {
              if (slot === "dialog-positioner") {
                return element.getAttribute("data-state") === "closed"
                  ? "dialog-positioner-exit"
                  : "none";
              }
              return element.getAttribute("data-state") === "open" ? "modal-open" : "modal-close";
            },
          },
          getPropertyValue: { value: style.getPropertyValue.bind(style) },
        });
      }
      return style;
    });
    const renderDialog = (open: boolean) => (
      <Dialog open={open}>
        <DialogContent>
          <DialogTitle>Exit test</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    try {
      const view = render(renderDialog(true));
      view.rerender(renderDialog(false));

      const closingDialog = document.querySelector('[data-slot="dialog-content"]');
      expect(closingDialog?.getAttribute("data-state")).toBe("closed");
      view.rerender(renderDialog(true));
      expect(document.querySelector('[data-slot="dialog-content"]')).toBe(closingDialog);
      expect(closingDialog?.getAttribute("data-state")).toBe("open");
    } finally {
      computedStyle.mockRestore();
    }
  });

  test("keeps the body edge clear for focus rings and scrolls at the outer surface", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Resize test</DialogTitle>
          <DialogBody>
            <button type="button">Focus me</button>
          </DialogBody>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Resize test" });
    const body = screen.getByRole("button", { name: "Focus me" }).parentElement;
    expect(dialog.className).toContain("overflow-y-auto");
    expect(body?.className).not.toContain("overflow-y-auto");
  });

  test("animates each content-driven width and height change", async () => {
    const notifyResize = installResizeObserver();

    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Resize test</DialogTitle>
          <DialogBody>Content</DialogBody>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Resize test" });
    dialog.style.setProperty("--resize-dur", "300ms");
    dialog.style.setProperty("--resize-ease", "cubic-bezier(0.22, 1, 0.36, 1)");
    let finishAnimation: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      finishAnimation = resolve;
    });
    const animation = new Animation();
    Object.defineProperty(animation, "finished", { value: finished });
    const animate = spyOn(dialog, "animate").mockReturnValue(animation);

    notifyResize(400, 250);
    notifyResize(500, 320);

    expect(animate).toHaveBeenCalledWith(
      [
        {
          width: "400px",
          height: "250px",
          maxWidth: "none",
          maxHeight: "none",
        },
        {
          width: "500px",
          height: "320px",
          maxWidth: "none",
          maxHeight: "none",
        },
      ],
      { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    expect(dialog.hasAttribute("data-dialog-resizing")).toBe(true);
    notifyResize(550, 360);
    expect(animate).toHaveBeenCalledTimes(1);
    finishAnimation();
    await finished;
    await waitFor(() => expect(dialog.hasAttribute("data-dialog-resizing")).toBe(false));
    notifyResize(550, 360);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  test("keeps scrollbars needed by the target layout visible during resize", async () => {
    const notifyResize = installResizeObserver();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Resize test</DialogTitle>
          <DialogBody className="overflow-y-auto">Scrollable content</DialogBody>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Resize test" });
    const body = screen.getByText("Scrollable content");
    dialog.style.overflowY = "auto";
    body.style.overflowY = "auto";
    Object.defineProperties(dialog, {
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 300 },
    });
    let finishAnimation: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      finishAnimation = resolve;
    });
    const animation = new Animation();
    Object.defineProperty(animation, "finished", { value: finished });
    spyOn(dialog, "animate").mockReturnValue(animation);

    notifyResize(400, 250);
    notifyResize(500, 320);

    expect(dialog.hasAttribute("data-dialog-scrollbar-hidden")).toBe(true);
    expect(body.hasAttribute("data-dialog-scrollbar-hidden")).toBe(false);
    finishAnimation();
    await waitFor(() => expect(dialog.hasAttribute("data-dialog-scrollbar-hidden")).toBe(false));
  });

  test("retargets a resize when content changes before the first animation ends", async () => {
    const notifyResize = installResizeObserver();
    const renderDialog = (content: string) => (
      <Dialog open>
        <DialogContent>
          <DialogTitle>Resize test</DialogTitle>
          <DialogBody>
            {content}
            <img alt="" data-testid="late-image" />
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
    const view = render(renderDialog("Before"));
    const dialog = screen.getByRole("dialog", { name: "Resize test" });
    dialog.style.setProperty("--resize-dur", "300ms");
    dialog.style.setProperty("--resize-ease", "cubic-bezier(0.22, 1, 0.36, 1)");

    let naturalHeight = 320;
    let animationActive = false;
    let cancellations = 0;
    spyOn(dialog, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 400, animationActive ? 280 : naturalHeight),
    );
    const animate = spyOn(dialog, "animate").mockImplementation(() => {
      animationActive = true;
      let rejectFinished: () => void = () => {};
      const finished = new Promise<void>((_, reject) => {
        rejectFinished = () => reject(new DOMException("Animation canceled", "AbortError"));
      });
      const animation = new Animation();
      Object.defineProperty(animation, "finished", { value: finished });
      spyOn(animation, "cancel").mockImplementation(() => {
        animationActive = false;
        cancellations += 1;
        rejectFinished();
      });
      return animation;
    });

    notifyResize(400, 250);
    notifyResize(400, 320);
    naturalHeight = 250;
    view.rerender(renderDialog("After"));

    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2), {
      timeout: 300,
    });
    expect(cancellations).toBe(1);
    expect(animate.mock.calls[1]?.[0]).toEqual([
      { width: "400px", height: "280px", maxWidth: "none", maxHeight: "none" },
      { width: "400px", height: "250px", maxWidth: "none", maxHeight: "none" },
    ]);

    naturalHeight = 300;
    view.rerender(renderDialog("Third"));
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(3), {
      timeout: 300,
    });
    expect(cancellations).toBe(2);

    naturalHeight = 350;
    fireEvent.load(view.getByTestId("late-image"));
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(4), {
      timeout: 300,
    });
    expect(animate.mock.calls[3]?.[0]).toEqual([
      { width: "400px", height: "280px", maxWidth: "none", maxHeight: "none" },
      { width: "400px", height: "350px", maxWidth: "none", maxHeight: "none" },
    ]);

    naturalHeight = 360;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(5), {
      timeout: 300,
    });
  });

  test("skips resize motion when reduced motion is requested", () => {
    const notifyResize = installResizeObserver();
    const originalMatchMedia = window.matchMedia.bind(window);
    const matchMedia = spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = originalMatchMedia(query);
      Object.defineProperty(result, "matches", { value: true });
      return result;
    });
    try {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Resize test</DialogTitle>
            <DialogBody>Content</DialogBody>
          </DialogContent>
        </Dialog>,
      );

      const dialog = screen.getByRole("dialog", { name: "Resize test" });
      const animate = spyOn(dialog, "animate");
      notifyResize(400, 250);
      notifyResize(500, 320);
      expect(animate).not.toHaveBeenCalled();
      expect(dialog.hasAttribute("data-dialog-resizing")).toBe(false);
    } finally {
      matchMedia.mockRestore();
    }
  });
});
