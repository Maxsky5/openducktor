import type { Viewport } from "@xyflow/react";
import { type Box, unionBox } from "./canvas-geometry";

/** Below this zoom, the box and label text is too small to read, so a large workflow pans. */
export const MIN_FIT_ZOOM = 0.8;
/** The lowest zoom of the Fit control, where the boxes still show their shape. */
export const MIN_SHOW_ALL_ZOOM = 0.3;
/**
 * Every workflow that fits opens at the same zoom, close to the zoom of a workflow that just fits,
 * so the boxes look the same size in a small workflow and in a large one.
 */
export const MAX_FIT_ZOOM = 0.85;
/** The room of the toolbar above and of the zoom controls at the bottom left. */
const PADDING = { top: 64, right: 40, bottom: 48, left: 64 };
/** The space that a revealed selection keeps from the canvas edges. */
const REVEAL_MARGIN = 48;

export type CanvasSize = { readonly width: number; readonly height: number };

/** The box around all boxes and lines, or null without a box. */
export const contentBounds = (boxes: readonly Box[]): Box | null =>
  boxes.length === 0 ? null : unionBox(boxes);

/**
 * The viewport that shows the whole workflow, at a zoom between `MIN_FIT_ZOOM` and `MAX_FIT_ZOOM`.
 * A workflow that does not fit at the lowest zoom shows from its start: the top rows, and the
 * left columns when it is also too wide. An axis that fits is centered, so no box is cut there.
 */
export const readableViewport = (
  bounds: Box | null,
  size: CanvasSize,
  /** The Fit control shows the whole workflow, even when its text gets small. */
  minZoom = MIN_FIT_ZOOM,
): Viewport => {
  if (bounds === null) return { x: PADDING.left, y: PADDING.top, zoom: MAX_FIT_ZOOM };
  const roomX = size.width - PADDING.left - PADDING.right;
  const roomY = size.height - PADDING.top - PADDING.bottom;
  const zoom = Math.min(
    MAX_FIT_ZOOM,
    Math.max(minZoom, Math.min(roomX / bounds.width, roomY / bounds.height)),
  );
  const place = (start: number, room: number, from: number, length: number) => {
    const free = room - length * zoom;
    return start + Math.max(0, free / 2) - from * zoom;
  };
  return {
    x: place(PADDING.left, roomX, bounds.x, bounds.width),
    y: place(PADDING.top, roomY, bounds.y, bounds.height),
    zoom,
  };
};

/**
 * The smallest pan that shows a selection: the selection with its neighbours when they fit, else
 * the selection alone. A selection in view keeps the viewport.
 */
export const revealViewport = (
  viewport: Viewport,
  size: CanvasSize,
  selection: Box,
  neighbours: Box,
): Viewport => {
  const { zoom } = viewport;
  const fits = (box: Box) =>
    box.width * zoom <= size.width - REVEAL_MARGIN * 2 &&
    box.height * zoom <= size.height - REVEAL_MARGIN * 2;
  const shown = fits(neighbours) ? neighbours : selection;
  const shift = (offset: number, start: number, length: number, room: number) => {
    const low = start * zoom + offset;
    const high = (start + length) * zoom + offset;
    if (low < REVEAL_MARGIN) return offset + REVEAL_MARGIN - low;
    if (high > room - REVEAL_MARGIN) return offset - (high - room + REVEAL_MARGIN);
    return offset;
  };
  return {
    x: shift(viewport.x, shown.x, shown.width, size.width),
    y: shift(viewport.y, shown.y, shown.height, size.height),
    zoom,
  };
};
