import type {
  Terminal,
  XtermDisposable,
  XtermMarker,
  XtermTouch,
  XtermTouchEvent,
} from "@xterm/xterm/lib/xterm.mjs";
import { pageDocument, pageRoot } from "./page-runtime";

const LONG_PRESS_MS = 450;
const TOUCH_SLOP_PX = 10;
const CAPTURE_TOUCH = { capture: true, passive: false };
type SelectionRange = { start: number; end: number };
type TouchTerminal = Pick<
  Terminal,
  | "element"
  | "cols"
  | "rows"
  | "buffer"
  | "getSelectionPosition"
  | "select"
  | "onSelectionChange"
  | "onScroll"
  | "onResize"
  | "scrollLines"
  | "scrollToLine"
  | "registerMarker"
  | "clearSelection"
>;

/** Long-press word selection and touch handles over xterm's public selection API. */
export const installTerminalTouchSelection = (current: TouchTerminal): void => {
  const element = current.element;
  if (element === undefined) throw new Error("The terminal has no page element.");
  const root = pageRoot();
  let pressTimer: number | null = null;
  let scrollTimer: number | null = null;
  let scrollRow = 0;
  let scrolling = false;
  let start: XtermTouch | null = null;
  let anchor: { startColumn: number; endColumn: number } | null = null;
  let anchorLine: XtermMarker | null = null;
  let anchorLineListener: XtermDisposable | null = null;
  let drag: { edge: keyof SelectionRange; offset: XtermTouch } | null = null;

  const geometry = () => {
    const rect = element.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { rect, width: rect.width / current.cols, height: rect.height / current.rows };
  };
  const indexAt = (touch: XtermTouch, boundary: boolean): number | null => {
    const grid = geometry();
    if (grid === null) return null;
    const column = Math.floor((touch.clientX - grid.rect.left) / grid.width);
    const row = Math.floor((touch.clientY - grid.rect.top) / grid.height);
    return (
      (current.buffer.active.viewportY + Math.min(current.rows - 1, Math.max(0, row))) *
        current.cols +
      Math.min(current.cols - (boundary ? 0 : 1), Math.max(0, column))
    );
  };
  const range = (): SelectionRange | null => {
    const position = current.getSelectionPosition();
    return position === undefined
      ? null
      : {
          start: position.start.y * current.cols + position.start.x,
          end: position.end.y * current.cols + position.end.x,
        };
  };
  const select = ({ start, end }: SelectionRange): void => {
    const cellAt = (index: number) =>
      current.buffer.active
        .getLine(Math.floor(index / current.cols))
        ?.getCell(index % current.cols);
    // A zero-width cell is the second half of a wide character.
    if (cellAt(start)?.getWidth() === 0) start -= 1;
    if (cellAt(end)?.getWidth() === 0) end += 1;
    current.select(start % current.cols, Math.floor(start / current.cols), end - start);
  };
  const wordAt = (index: number): SelectionRange => {
    const row = Math.floor(index / current.cols);
    const line = current.buffer.active.getLine(row);
    const isWord = (column: number): boolean => {
      const cell = line?.getCell(column);
      return cell !== undefined && (cell.getWidth() === 0 || /\S/u.test(cell.getChars()));
    };
    let first = index % current.cols;
    let last = first;
    if (isWord(first)) {
      while (first > 0 && isWord(first - 1)) first -= 1;
      while (last < current.cols - 1 && isWord(last + 1)) last += 1;
    }
    return { start: row * current.cols + first, end: row * current.cols + last + 1 };
  };

  const handles = {
    start: pageDocument.createElement("div"),
    end: pageDocument.createElement("div"),
  };
  const updateHandles = (): void => {
    const selected = range();
    const grid = geometry();
    const bounds = root.getBoundingClientRect();
    for (const edge of ["start", "end"] as const) {
      const handle = handles[edge];
      if (selected === null || grid === null) {
        handle.style.setProperty("display", "none");
        continue;
      }
      const index = edge === "end" ? selected.end - 1 : selected.start;
      const row = Math.floor(index / current.cols) - current.buffer.active.viewportY;
      handle.style.setProperty("display", row >= 0 && row < current.rows ? "block" : "none");
      const column = (index % current.cols) + (edge === "end" ? 1 : 0);
      handle.style.setProperty("left", `${grid.rect.left - bounds.left + column * grid.width}px`);
      const top = grid.rect.top - bounds.top + (row + (edge === "end" ? 1 : 0)) * grid.height;
      const visibleTop = edge === "start" ? Math.max(34, top) : Math.min(top, bounds.height - 34);
      handle.style.setProperty("top", `${visibleTop}px`);
    }
  };
  const cancelScroll = (): void => {
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    scrollTimer = null;
  };
  const cancelPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };
  const stopGesture = (): void => {
    cancelPress();
    cancelScroll();
    start = null;
    scrolling = false;
    anchor = null;
    drag = null;
    anchorLineListener?.dispose();
    anchorLineListener = null;
    anchorLine?.dispose();
    anchorLine = null;
  };
  const trackAnchorLine = (row: number): void => {
    const buffer = current.buffer.active;
    anchorLine = current.registerMarker(row - buffer.baseY - buffer.cursorY);
    anchorLineListener = anchorLine.onDispose(() => {
      stopGesture();
      current.clearSelection();
    });
  };
  const move = (touch: XtermTouch): void => {
    cancelScroll();
    const selected = range();
    if (selected === null) {
      stopGesture();
      return;
    }
    const point =
      drag === null
        ? touch
        : {
            clientX: touch.clientX - drag.offset.clientX,
            clientY: touch.clientY - drag.offset.clientY,
          };
    const grid = geometry();
    if (grid === null) return;
    let direction = 0;
    if (point.clientY < grid.rect.top) direction = -1;
    else if (point.clientY >= grid.rect.top + grid.rect.height) direction = 1;
    if (direction !== 0) current.scrollLines(direction);
    const index = indexAt(point, drag !== null);
    if (index === null) return;
    if (drag !== null) {
      select(
        drag.edge === "start"
          ? { start: Math.min(index, selected.end - 1), end: selected.end }
          : { start: selected.start, end: Math.max(index, selected.start + 1) },
      );
    } else if (anchor !== null && anchorLine !== null) {
      const rowStart = anchorLine.line * current.cols;
      select({
        start: Math.min(rowStart + anchor.startColumn, index),
        end: Math.max(rowStart + anchor.endColumn, index + 1),
      });
    }
    if (direction !== 0) scrollTimer = setTimeout(() => move(touch), 60);
  };
  const finish = (event: XtermTouchEvent): void => {
    if (anchor !== null || drag !== null || scrolling) {
      event.preventDefault();
      event.stopPropagation();
    }
    stopGesture();
  };

  for (const edge of ["start", "end"] as const) {
    const handle = handles[edge];
    handle.className = "terminal-selection-handle";
    handle.setAttribute("data-edge", edge);
    handle.setAttribute("aria-hidden", "true");
    handle.style.setProperty("display", "none");
    handle.addEventListener(
      "touchstart",
      (event) => {
        const selected = range();
        const touch = event.touches[0];
        const grid = geometry();
        if (selected === null || grid === null || touch === undefined || event.touches.length !== 1)
          return;
        // Short selections have overlapping touch areas. Pick the nearer visible knob.
        const distance = (candidate: keyof SelectionRange): number => {
          const rect = handles[candidate].getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return Number.POSITIVE_INFINITY;
          return Math.hypot(
            touch.clientX - rect.left - 22,
            touch.clientY - rect.top - (candidate === "start" ? 7 : 23),
          );
        };
        const nearest = distance("start") < distance("end") ? "start" : "end";
        const index = nearest === "end" ? selected.end - 1 : selected.start;
        const column = (index % current.cols) + (nearest === "end" ? 1 : 0);
        const row = Math.floor(index / current.cols) - current.buffer.active.viewportY;
        stopGesture();
        trackAnchorLine(
          Math.floor((nearest === "start" ? selected.end - 1 : selected.start) / current.cols),
        );
        drag = {
          edge: nearest,
          offset: {
            clientX: touch.clientX - (grid.rect.left + column * grid.width),
            clientY: touch.clientY - (grid.rect.top + (row + 0.5) * grid.height),
          },
        };
        event.preventDefault();
        event.stopPropagation();
      },
      CAPTURE_TOUCH,
    );
    handle.addEventListener(
      "touchmove",
      (event) => {
        const touch = event.touches[0];
        if (drag === null || touch === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        move(touch);
      },
      CAPTURE_TOUCH,
    );
    handle.addEventListener("touchend", finish, CAPTURE_TOUCH);
    handle.addEventListener("touchcancel", finish, CAPTURE_TOUCH);
    root.append(handle);
  }
  current.onSelectionChange(updateHandles);
  current.onScroll(updateHandles);
  current.onResize(updateHandles);

  element.addEventListener(
    "touchstart",
    (event) => {
      stopGesture();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch === undefined) return;
      start = { clientX: touch.clientX, clientY: touch.clientY };
      scrollRow = current.buffer.active.viewportY;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (start === null) return;
        const index = indexAt(start, false);
        if (index === null) return;
        const word = wordAt(index);
        const row = Math.floor(word.start / current.cols);
        trackAnchorLine(row);
        anchor = {
          startColumn: word.start - row * current.cols,
          endColumn: word.end - row * current.cols,
        };
        select(word);
      }, LONG_PRESS_MS);
    },
    CAPTURE_TOUCH,
  );
  element.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch === undefined) {
        finish(event);
        return;
      }
      if (anchor === null) {
        if (start === null) return;
        const distance = Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY);
        if (!scrolling && distance <= TOUCH_SLOP_PX) return;
        scrolling = true;
        cancelPress();
        const grid = geometry();
        if (grid === null) return;
        event.preventDefault();
        event.stopPropagation();
        current.scrollToLine(scrollRow + Math.round((start.clientY - touch.clientY) / grid.height));
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      move(touch);
    },
    CAPTURE_TOUCH,
  );
  element.addEventListener("touchend", finish, CAPTURE_TOUCH);
  element.addEventListener("touchcancel", finish, CAPTURE_TOUCH);
  // xterm's desktop menu focuses its text field. On mobile this opens the keyboard and refits away the selection.
  element.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    CAPTURE_TOUCH,
  );
};
