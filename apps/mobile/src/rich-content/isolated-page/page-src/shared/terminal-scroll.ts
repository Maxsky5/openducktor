import type { Terminal, XtermPageElement } from "@xterm/xterm/lib/xterm.mjs";

type ScrollElement = XtermPageElement & {
  className: string;
  scrollTop: number;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "scroll", listener: () => void): void;
};
declare const document: { createElement(tag: "div"): ScrollElement };
declare const ResizeObserver: new (
  callback: (entries: readonly { contentRect: { height: number } }[]) => void,
) => { observe(target: XtermPageElement): void };

/** Native touch scrolling drives xterm through its public viewport API. */
export const installTerminalScroll = (current: Terminal, root: XtermPageElement): void => {
  const element = current.element;
  const screen = element?.querySelector(".xterm-screen");
  if (!element || !screen) throw new Error("The terminal has no screen element.");
  const viewport = document.createElement("div");
  viewport.className = "terminal-scroll-viewport";
  const spacer = document.createElement("div");
  spacer.setAttribute("aria-hidden", "true");
  viewport.append(element, spacer);
  root.append(viewport);

  let cellHeight = 0;
  let scrollHeight = 0;
  const sync = (): void => {
    if (!(cellHeight > 0)) return;
    const { baseY, viewportY } = current.buffer.active;
    const height = baseY * cellHeight;
    if (height !== scrollHeight) {
      scrollHeight = height;
      spacer.style.setProperty("height", `${height}px`);
    }
    // Preserve fractional native positions during a fling; follow independent xterm moves.
    if (Math.round(viewport.scrollTop / cellHeight) !== viewportY)
      viewport.scrollTop = viewportY * cellHeight;
  };
  new ResizeObserver(([entry]) => {
    if (!entry) return;
    cellHeight = entry.contentRect.height / current.rows;
    sync();
  }).observe(screen);
  viewport.addEventListener("scroll", () => {
    if (cellHeight > 0) current.scrollToLine(Math.round(viewport.scrollTop / cellHeight));
  });
  current.onScroll(sync);
  current.onResize(sync);
  current.onWriteParsed(sync);
  current.buffer.onBufferChange(sync);
};
