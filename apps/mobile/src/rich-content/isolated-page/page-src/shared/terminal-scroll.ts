import type { Terminal, XtermPageElement } from "@xterm/xterm/lib/xterm.mjs";

type PointerEvent = {
  readonly pointerId: number;
  readonly clientY: number;
  preventDefault(): void;
};
type ScrollElement = XtermPageElement & {
  className: string;
  scrollTop: number;
  readonly clientHeight: number;
  setAttribute(name: string, value: string): void;
  setPointerCapture(pointerId: number): void;
  addEventListener(type: "scroll", listener: () => void): void;
  addEventListener(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
  ): void;
};
declare const document: { createElement(tag: "div"): ScrollElement };

/** Native touch scrolling drives xterm through its public viewport API. */
export const installTerminalScroll = (current: Terminal, root: XtermPageElement): void => {
  const element = current.element;
  if (element === undefined) throw new Error("The terminal has no page element.");
  const viewport = document.createElement("div");
  viewport.className = "terminal-scroll-viewport";
  const spacer = document.createElement("div");
  spacer.setAttribute("aria-hidden", "true");
  viewport.append(element, spacer);
  const rail = document.createElement("div");
  rail.className = "terminal-scrollbar";
  rail.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "terminal-scrollbar-thumb";
  rail.append(thumb);
  root.append(viewport, rail);

  let cellHeight = 0;
  let thumbHeight = 0;
  let travel = 0;
  let drag: { pointerId: number; offset: number } | null = null;

  const drawThumb = (): void => {
    const base = current.buffer.active.baseY;
    const progress = base === 0 || cellHeight === 0 ? 0 : viewport.scrollTop / (base * cellHeight);
    thumb.style.setProperty("transform", `translateY(${Math.min(1, progress) * travel}px)`);
  };
  const sync = (): void => {
    const screen = element.querySelector(".xterm-screen");
    if (screen === null) return;
    cellHeight = screen.getBoundingClientRect().height / current.rows;
    if (!(cellHeight > 0)) return;
    const { baseY, viewportY } = current.buffer.active;
    spacer.style.setProperty("height", `${baseY * cellHeight}px`);
    thumbHeight = Math.min(
      viewport.clientHeight,
      Math.max(48, (viewport.clientHeight * current.rows) / (baseY + current.rows)),
    );
    travel = viewport.clientHeight - thumbHeight;
    thumb.style.setProperty("height", `${thumbHeight}px`);
    rail.style.setProperty("display", baseY > 0 ? "block" : "none");
    // Keep fractional native scroll positions during a swipe. Output, keys, and restores can
    // move xterm independently, in which case the native viewport follows that new row.
    if (Math.round(viewport.scrollTop / cellHeight) !== viewportY)
      viewport.scrollTop = viewportY * cellHeight;
    drawThumb();
  };
  viewport.addEventListener("scroll", () => {
    if (cellHeight <= 0) return;
    current.scrollToLine(Math.round(viewport.scrollTop / cellHeight));
    drawThumb();
  });
  const seek = (clientY: number, offset: number): void => {
    if (travel <= 0) return;
    const position = clientY - rail.getBoundingClientRect().top - offset;
    viewport.scrollTop =
      Math.max(0, Math.min(1, position / travel)) * current.buffer.active.baseY * cellHeight;
  };
  rail.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const top = thumb.getBoundingClientRect().top;
    const offset =
      event.clientY >= top && event.clientY <= top + thumbHeight
        ? event.clientY - top
        : thumbHeight / 2;
    drag = { pointerId: event.pointerId, offset };
    rail.setPointerCapture(event.pointerId);
    seek(event.clientY, offset);
  });
  rail.addEventListener("pointermove", (event) => {
    if (drag?.pointerId === event.pointerId) seek(event.clientY, drag.offset);
  });
  for (const type of ["pointerup", "pointercancel"] as const)
    rail.addEventListener(type, () => {
      drag = null;
    });
  current.onScroll(sync);
  current.onResize(sync);
  current.onRender(sync);
  current.onWriteParsed(sync);
  current.buffer.onBufferChange(sync);
  sync();
};
