import type { BrowserBox } from "@openducktor/contracts";

export const BROWSER_COMMENT_BOX_WIDTH = 320;
const BOX_HEIGHT = 240;
const GAP = 8;

/** The box around all selected elements. */
export const selectionBox = (boxes: readonly BrowserBox[]): BrowserBox => {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Places the comment box under the selection, or above it when the page area has no room below. */
export const commentBoxPosition = (
  selection: BrowserBox,
  bounds: { width: number; height: number },
) => {
  const left = Math.max(GAP, Math.min(selection.x, bounds.width - BROWSER_COMMENT_BOX_WIDTH - GAP));
  const below = selection.y + selection.height + GAP;
  const top =
    below + BOX_HEIGHT <= bounds.height ? below : Math.max(GAP, selection.y - BOX_HEIGHT - GAP);
  return { left, top };
};
