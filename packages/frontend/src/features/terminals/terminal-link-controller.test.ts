import { describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { IBufferLine, IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { createLinkController, hasOpenKey } from "./terminal-link-controller";

if (globalThis.document === undefined) GlobalRegistrator.register();

const createLine = (text: string, columns: number): IBufferLine => ({
  isWrapped: false,
  length: columns,
  getCell: (column) => {
    const character = text[column] ?? "";
    const cell = {
      getChars: () => character,
      getCode: () => (character ? (character.codePointAt(0) ?? 0) : 0),
      getWidth: () => 1,
    };
    // SAFETY: This fake has the three cell methods that the link reader calls.
    return cell as ReturnType<IBufferLine["getCell"]>;
  },
  translateToString: () => text,
});

const createHarness = (openUrl: (url: string) => Promise<void>) => {
  const columns = 20;
  const container = document.createElement("div");
  const terminalElement = document.createElement("div");
  const screen = document.createElement("div");
  terminalElement.className = "xterm";
  screen.className = "xterm-screen";
  terminalElement.append(screen);
  container.append(terminalElement);
  document.body.append(container);
  // SAFETY: The pointer code reads only these six box fields.
  screen.getBoundingClientRect = () =>
    ({ left: 0, right: 200, top: 0, bottom: 120, width: 200, height: 20 }) as DOMRect;

  const listeners: Array<() => void> = [];
  const event = (listener: () => void): IDisposable => {
    listeners.push(listener);
    return { dispose: () => undefined };
  };
  let provider: ILinkProvider | null = null;
  const line = createLine("https://a.test", columns);
  const terminalContract = {
    buffer: {
      active: { getLine: () => line, length: 1, viewportY: 0 },
      onBufferChange: event,
    },
    cols: columns,
    element: terminalElement,
    onRender: event,
    onResize: event,
    onScroll: event,
    onWriteParsed: event,
    registerLinkProvider: (nextProvider: ILinkProvider) => {
      provider = nextProvider;
      return { dispose: () => undefined };
    },
    rows: 1,
  };
  const terminal: Terminal = Object.assign(Object.create(null), terminalContract);
  const reportOpenError = mock((url: string, cause: unknown) => {
    if (url.length === 0) throw new Error("Expected a non-empty URL.");
    if (!(cause instanceof Error)) throw new Error("Expected an Error cause.");
  });
  const controller = createLinkController({ container, openUrl, reportOpenError });
  controller.activate(terminal);
  if (!provider) throw new Error("Expected the terminal link provider to register.");
  let link: ILink | undefined;
  // SAFETY: activate stores the provider through the fake above.
  (provider as ILinkProvider).provideLinks(1, (links) => {
    link = links?.[0];
  });
  if (!link) throw new Error("Expected a link for the test terminal.");

  const dispatchMouse = (type: string, values: MouseEventInit = {}): MouseEvent => {
    const mouseEvent = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 5,
      clientY: 5,
      ctrlKey: true,
      ...values,
    });
    container.dispatchEvent(mouseEvent);
    return mouseEvent;
  };

  return { container, controller, dispatchMouse, link, reportOpenError, screen };
};

describe("terminal link controller", () => {
  test("uses Cmd on macOS and Ctrl on other platforms", () => {
    expect(hasOpenKey({ metaKey: true, ctrlKey: false }, "MacIntel")).toBe(true);
    expect(hasOpenKey({ metaKey: false, ctrlKey: true }, "MacIntel")).toBe(false);
    expect(hasOpenKey({ metaKey: false, ctrlKey: true }, "Win32")).toBe(true);
  });

  test("opens one link for a modified primary click and blocks the browser click", async () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    try {
      harness.link.hover?.(harness.dispatchMouse("mousemove"), harness.link.text);
      const down = harness.dispatchMouse("mousedown");
      const up = harness.dispatchMouse("mouseup");
      const click = harness.dispatchMouse("click");

      expect(down.defaultPrevented).toBe(true);
      expect(up.defaultPrevented).toBe(true);
      expect(click.defaultPrevented).toBe(true);
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith("https://a.test");
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("does not open for an ordinary click or a drag", () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    try {
      harness.link.hover?.(harness.dispatchMouse("mousemove"), harness.link.text);
      harness.dispatchMouse("mousedown", { ctrlKey: false });
      harness.dispatchMouse("mouseup", { ctrlKey: false });
      harness.dispatchMouse("mousedown");
      harness.dispatchMouse("mousemove", { clientX: 15 });
      harness.dispatchMouse("mouseup", { clientX: 15 });

      expect(openUrl).not.toHaveBeenCalled();
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("opens a validated OSC 8 destination instead of its visible label", () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    try {
      const event = harness.dispatchMouse("mousemove");
      const range = harness.link.range;
      harness.controller.linkHandler.hover?.(event, "https://osc.test/path", range);
      harness.dispatchMouse("mousedown");
      harness.dispatchMouse("mouseup");

      expect(openUrl).toHaveBeenCalledWith("https://osc.test/path");
      expect(openUrl).toHaveBeenCalledTimes(1);
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("resolves an OSC 8 destination before the first modified press", () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    const parentMouseMove = mock(() => undefined);
    const handleMouseMove = (event: MouseEvent) => {
      harness.controller.linkHandler.hover?.(
        event,
        "https://osc.test/first-press",
        harness.link.range,
      );
    };
    harness.screen.addEventListener("mousemove", handleMouseMove);
    harness.container.addEventListener("mousemove", parentMouseMove);
    try {
      harness.dispatchMouse("mousedown");
      harness.dispatchMouse("mouseup");

      expect(openUrl).toHaveBeenCalledWith("https://osc.test/first-press");
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(parentMouseMove).not.toHaveBeenCalled();
    } finally {
      harness.screen.removeEventListener("mousemove", handleMouseMove);
      harness.container.removeEventListener("mousemove", parentMouseMove);
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("does not replace an unresolved xterm link with its visible URL", () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    try {
      harness.screen.classList.add("xterm-cursor-pointer");
      harness.dispatchMouse("mousedown");
      harness.dispatchMouse("mouseup");

      expect(openUrl).not.toHaveBeenCalled();
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("stops press listeners when the window loses focus", () => {
    const openUrl = mock(async (_url: string) => undefined);
    const harness = createHarness(openUrl);
    try {
      harness.link.hover?.(harness.dispatchMouse("mousemove"), harness.link.text);
      harness.dispatchMouse("mousedown");
      window.dispatchEvent(new Event("blur"));

      const move = harness.dispatchMouse("mousemove", { ctrlKey: false });
      const up = harness.dispatchMouse("mouseup", { ctrlKey: false });

      expect(move.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      expect(openUrl).not.toHaveBeenCalled();
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });

  test("updates the pointer on modifier changes and reports opener errors", async () => {
    const failure = new Error("opener unavailable");
    const harness = createHarness(async () => Promise.reject(failure));
    try {
      harness.link.hover?.(
        harness.dispatchMouse("mousemove", { ctrlKey: false }),
        harness.link.text,
      );
      expect(harness.container.classList.contains("odt-terminal-link-pointer")).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "Control" }));
      expect(harness.container.classList.contains("odt-terminal-link-pointer")).toBe(true);

      harness.dispatchMouse("mousedown");
      harness.dispatchMouse("mouseup");
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.reportOpenError).toHaveBeenCalledWith("https://a.test", failure);

      window.dispatchEvent(new KeyboardEvent("keyup", { ctrlKey: false, key: "Control" }));
      expect(harness.container.classList.contains("odt-terminal-link-pointer")).toBe(false);
    } finally {
      harness.controller.dispose();
      harness.container.remove();
    }
  });
});
