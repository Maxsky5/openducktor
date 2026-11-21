import { type RefObject, useEffect, useEffectEvent } from "react";
import type { Box } from "./canvas-geometry";
import { readableViewport } from "./canvas-viewport";
import type { ViewportMover } from "./use-viewport-mover";

type Size = { readonly width: number; readonly height: number };

/**
 * A change of more than this many pixels comes from a panel that opens or closes, so the fit
 * moves smoothly. A smaller change comes from a drag of a panel edge, so the fit follows at once.
 */
const JUMP = 24;

/**
 * Fits the workflow again when the canvas size changes, such as when the details panel or the
 * problem list opens or closes, while the whole workflow showed before the change. A workflow that
 * the user panned past the edges keeps its viewport.
 */
export const useRefitOnResize = (
  container: RefObject<HTMLElement | null>,
  content: Box | null,
  mover: ViewportMover,
): void => {
  const refit = useEffectEvent((before: Size, after: Size) => {
    if (content === null) return;
    // A fit that still runs counts as done, so a quick close and open keep the workflow in view.
    const { x, y, zoom } = mover.target();
    const showed =
      content.x * zoom + x >= 0 &&
      content.y * zoom + y >= 0 &&
      (content.x + content.width) * zoom + x <= before.width &&
      (content.y + content.height) * zoom + y <= before.height;
    if (!showed) return;
    const jump =
      Math.abs(after.width - before.width) > JUMP || Math.abs(after.height - before.height) > JUMP;
    mover.move(readableViewport(content, after), jump);
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let size: Size = { width: element.clientWidth, height: element.clientHeight };
    const observer = new ResizeObserver(() => {
      const next: Size = { width: element.clientWidth, height: element.clientHeight };
      if (next.width === size.width && next.height === size.height) return;
      refit(size, next);
      size = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
};
