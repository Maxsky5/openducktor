import { expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Dialog } from "./dialog";
import { MarkdownMermaidDialog } from "./markdown-mermaid-dialog";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>Selected</text></svg>';

test("fits an isolated diagram, zooms and pans it, and reports image load errors", async () => {
  const createUrl = spyOn(URL, "createObjectURL").mockReturnValue("blob:diagram");
  const revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([], this);
    }
    unobserve() {}
    disconnect() {}
  };

  try {
    const view = render(
      <Dialog open>
        <MarkdownMermaidDialog svg={svg} />
      </Dialog>,
    );
    const image = await view.findByRole("img", { name: "Expanded Mermaid diagram" });
    if (!(image instanceof HTMLImageElement)) throw new Error("The diagram image is missing.");
    expect(image.getAttribute("src")).toBe("blob:diagram");
    expect(image.style.width).toBe("800px");
    expect(createUrl).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    expect(image.style.width).toBe("1200px");
    fireEvent.click(view.getByRole("button", { name: "Zoom out" }));
    expect(image.style.width).toBe("800px");
    const viewport = view.getByRole("region", { name: "Diagram preview viewport" });
    const scrollTo = mock(() => {});
    viewport.scrollTo = scrollTo;
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(view.getByRole("button", { name: "Fit diagram" }));
    expect(image.style.width).toBe("800px");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    viewport.scrollLeft = 120;
    viewport.scrollTop = 80;
    const setPointerCapture = mock(() => {});
    viewport.setPointerCapture = setPointerCapture;
    fireEvent.pointerDown(viewport, {
      pointerType: "mouse",
      pointerId: 7,
      button: 0,
      clientX: 300,
      clientY: 200,
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 260, clientY: 150 });
    expect(viewport.scrollLeft).toBe(160);
    expect(viewport.scrollTop).toBe(130);
    fireEvent.pointerUp(viewport, { pointerId: 7 });
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 200, clientY: 100 });
    expect(viewport.scrollLeft).toBe(160);
    expect(viewport.scrollTop).toBe(130);

    fireEvent.error(image);
    expect(view.getByRole("alert").textContent).toContain("could not load");
    view.unmount();
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:diagram"));
  } finally {
    globalThis.ResizeObserver = originalObserver;
    if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  }
});
