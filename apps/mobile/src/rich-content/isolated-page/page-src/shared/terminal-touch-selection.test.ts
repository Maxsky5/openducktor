import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (globalThis.document === undefined) GlobalRegistrator.register();
const { installTerminalTouchSelection } = await import("./terminal-touch-selection");
const { Terminal } = await import("@xterm/xterm");
const opened: InstanceType<typeof Terminal>[] = [];

afterEach(() => {
  for (const terminal of opened.splice(0)) terminal.dispose();
  document.body.innerHTML = "";
});

const openTerminal = async (text: string) => {
  const parent = document.createElement("div");
  parent.id = "root";
  document.body.append(parent);
  parent.getBoundingClientRect = () => new DOMRect(0, 0, 200, 80);
  const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 2000, disableStdin: true });
  opened.push(terminal);
  terminal.open(parent);
  await new Promise<void>((resolve) => terminal.write(text, resolve));
  const screen = parent.querySelector(".xterm-screen");
  const element = terminal.element;
  if (!screen || !element) throw new Error("The terminal did not open.");
  screen.getBoundingClientRect = () => new DOMRect(0, 0, 200, 80);
  installTerminalTouchSelection(terminal);
  return { terminal, element, parent };
};

const touch = (element: Element, type: string, column: number, row = 0) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value:
      type === "touchend" || type === "touchcancel"
        ? []
        : [{ clientX: (column + 0.5) * 10, clientY: (row + 0.5) * 20 }],
  });
  element.dispatchEvent(event);
  return event;
};
const longPress = async (element: Element, column: number) => {
  touch(element, "touchstart", column);
  await new Promise((resolve) => setTimeout(resolve, 470));
};

test("extending a long press keeps the whole selected word", async () => {
  const { terminal, element } = await openTerminal("hello world");
  await longPress(element, 2);
  expect(terminal.getSelection()).toBe("hello");
  touch(element, "touchmove", 4);
  touch(element, "touchend", 4);
  expect(terminal.getSelection()).toBe("hello");
});

test.each([
  ["界界 hello world", 5],
  ["e\u0301 hello world", 3],
] as const)("selects buffer cells in %s", async (text, column) => {
  const { terminal, element } = await openTerminal(text);
  await longPress(element, column);
  touch(element, "touchend", column);
  expect(terminal.getSelection()).toBe("hello");
});

test("a short drag cancels a long press and does not also tap the terminal", async () => {
  const { terminal, element } = await openTerminal("hello world");
  touch(element, "touchstart", 2, 2);
  expect(touch(element, "touchmove", 2, 0).defaultPrevented).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 470));
  expect(touch(element, "touchend", 2, 0).defaultPrevented).toBe(true);
  expect(terminal.hasSelection()).toBe(false);

  touch(element, "touchstart", 2);
  expect(touch(element, "touchend", 2).defaultPrevented).toBe(false);
  expect(terminal.hasSelection()).toBe(false);
});

test("keeps handles after a finger lifts and adjusts either end across lines without input", async () => {
  const { terminal, parent } = await openTerminal("hello world\r\nsecond line");
  const sent: string[] = [];
  terminal.onData((data) => sent.push(data));
  terminal.select(0, 0, 5);
  const start = parent.querySelector<HTMLElement>('[data-edge="start"]');
  const end = parent.querySelector<HTMLElement>('[data-edge="end"]');
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  if (!start || !end) throw new Error("Selection handles are missing.");
  // Happy DOM does not lay out the CSS hit areas. These overlap as the on-screen handles do.
  start.getBoundingClientRect = () => new DOMRect(-22, 0, 44, 44);
  end.getBoundingClientRect = () => new DOMRect(28, 10, 44, 44);
  touch(end, "touchstart", 5);
  touch(end, "touchmove", 6, 1);
  touch(end, "touchend", 6, 1);
  expect(terminal.getSelection()).toBe("hello world\nsecond");
  touch(start, "touchstart", 0);
  touch(start, "touchmove", 6);
  touch(start, "touchend", 6);
  expect(terminal.getSelection()).toBe("world\nsecond");
  expect(sent).toEqual([]);
  terminal.clearSelection();
  expect(start.style.display).toBe("none");
  expect(end.style.display).toBe("none");
});

test("adjusts a range whose end is at the last column", async () => {
  const { terminal, parent } = await openTerminal("abcdefghijklmnopqrst\r\nnext row");
  terminal.select(0, 0, 20);
  const handle = parent.querySelector<HTMLElement>('[data-edge="end"]');
  if (!handle) throw new Error("The end handle is missing.");
  handle.getBoundingClientRect = () => new DOMRect(178, 10, 44, 44);
  touch(handle, "touchstart", 19);
  touch(handle, "touchmove", 18);
  touch(handle, "touchend", 18);
  expect(terminal.getSelection()).toBe("abcdefghijklmnopqrs");
});

test("scrolls while dragging past the viewport and stops on touch cancel", async () => {
  const { terminal, parent } = await openTerminal(
    Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\r\n"),
  );
  terminal.scrollToTop();
  terminal.select(0, 3, 4);
  const handle = parent.querySelector<HTMLElement>('[data-edge="end"]');
  if (!handle) throw new Error("The end handle is missing.");
  handle.getBoundingClientRect = () => new DOMRect(18, 46, 44, 44);
  touch(handle, "touchstart", 4, 3);
  touch(handle, "touchmove", 4, 5);
  expect(terminal.buffer.active.viewportY).toBeGreaterThan(0);
  touch(handle, "touchcancel", 4, 5);
  const stoppedAt = terminal.buffer.active.viewportY;
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(terminal.buffer.active.viewportY).toBe(stoppedAt);
});

test("a handle does not split a wide character", async () => {
  const { terminal, parent } = await openTerminal("界界 hello");
  terminal.select(0, 0, 10);
  const start = parent.querySelector<HTMLElement>('[data-edge="start"]');
  const end = parent.querySelector<HTMLElement>('[data-edge="end"]');
  if (!start || !end) throw new Error("Selection handles are missing.");
  start.getBoundingClientRect = () => new DOMRect(-22, 0, 44, 44);
  end.getBoundingClientRect = () => new DOMRect(78, 10, 44, 44);
  touch(start, "touchstart", 0);
  touch(start, "touchmove", 1);
  touch(start, "touchend", 1);
  expect(terminal.getSelection()).toBe("界界 hello");
  touch(end, "touchstart", 10);
  touch(end, "touchmove", 3);
  touch(end, "touchend", 3);
  expect(terminal.getSelection()).toBe("界界");
});

test("a visible handle does not grab the hidden end of a scrolled selection", async () => {
  const { terminal, parent } = await openTerminal(
    Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\r\n"),
  );
  const viewport = terminal.buffer.active.viewportY;
  terminal.select(0, 0, viewport * 20 + 4);
  const start = parent.querySelector<HTMLElement>('[data-edge="start"]');
  const end = parent.querySelector<HTMLElement>('[data-edge="end"]');
  if (!start || !end) throw new Error("Selection handles are missing.");
  expect(start.style.display).toBe("none");
  end.getBoundingClientRect = () => new DOMRect(18, 10, 44, 44);
  touch(end, "touchstart", 2);
  touch(end, "touchmove", 4);
  touch(end, "touchend", 4);
  expect(terminal.getSelectionPosition()?.start).toEqual({ x: 0, y: 0 });
  expect(terminal.getSelectionPosition()?.end).toEqual({ x: 6, y: viewport });
});

const fullScrollback = () =>
  Array.from({ length: 2004 }, (_, index) => `line ${index}`).join("\r\n");
const write = (terminal: InstanceType<typeof Terminal>, text: string) =>
  new Promise<void>((resolve) => terminal.write(text, resolve));

test.each(["start", "end"] as const)(
  "keeps the %s handle on the selected output when scrollback trims",
  async (edge) => {
    const { terminal, parent } = await openTerminal(fullScrollback());
    const selectedRow = 2001;
    terminal.select(0, selectedRow, "line 2001".length);
    const handle = parent.querySelector<HTMLElement>(`[data-edge="${edge}"]`);
    if (!handle) throw new Error("The selection handle is missing.");
    handle.getBoundingClientRect = () =>
      new DOMRect(edge === "start" ? -22 : 68, edge === "start" ? 0 : 30, 44, 44);
    touch(handle, "touchstart", edge === "start" ? 0 : 9, 1);
    await write(terminal, "\r\nline 2004");
    expect(terminal.getSelection()).toBe("line 2001");
    expect(terminal.getSelectionPosition()?.start.y).toBe(selectedRow - 1);
    touch(handle, "touchmove", edge === "start" ? 1 : 10, 0);
    touch(handle, "touchend", edge === "start" ? 1 : 10, 0);
    expect(terminal.getSelection()).toBe(edge === "start" ? "ine 2001" : "line 2001");
  },
);

test("stops a handle drag when its selected output leaves scrollback", async () => {
  const { terminal, parent } = await openTerminal(fullScrollback());
  terminal.scrollToTop();
  terminal.select(0, 0, "line 0".length);
  const handle = parent.querySelector<HTMLElement>('[data-edge="end"]');
  if (!handle) throw new Error("The end handle is missing.");
  handle.getBoundingClientRect = () => new DOMRect(38, 10, 44, 44);
  touch(handle, "touchstart", 6);
  await write(terminal, "\r\nline 2004");
  touch(handle, "touchmove", 7);
  touch(handle, "touchend", 7);
  expect(terminal.hasSelection()).toBe(false);
});

test("keeps the original word while a long-press drag trims scrollback", async () => {
  const { terminal, element } = await openTerminal(fullScrollback());
  touch(element, "touchstart", 2, 1);
  await new Promise((resolve) => setTimeout(resolve, 470));
  expect(terminal.getSelection()).toBe("line");
  await write(terminal, "\r\nline 2004");
  touch(element, "touchmove", 6);
  touch(element, "touchend", 6);
  expect(terminal.getSelection()).toBe("line 20");
});
