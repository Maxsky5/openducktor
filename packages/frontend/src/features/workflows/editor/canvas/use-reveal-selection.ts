import { type RefObject, useEffect, useEffectEvent } from "react";
import type { Box } from "./canvas-geometry";
import { revealViewport } from "./canvas-viewport";
import type { ViewportMover } from "./use-viewport-mover";

/** The selected box or label, and the box around it with its linked boxes. */
export type RevealTarget = { readonly selection: Box; readonly neighbours: Box };

/**
 * Pans the canvas by the smallest step that shows a new selection, such as after a click in the
 * outline or the problem list, or when the inspector opens and narrows the canvas. The zoom
 * stays. A drag of the selected box does not pan.
 */
export const useRevealSelection = (
  container: RefObject<HTMLElement | null>,
  selectionKey: string | null,
  target: RevealTarget | null,
  mover: ViewportMover,
): void => {
  const reveal = useEffectEvent(() => {
    const element = container.current;
    if (target === null || !element) return;
    // The pan plans from the end of a running fit, such as the one after the details panel opens.
    const viewport = mover.target();
    const size = { width: element.clientWidth, height: element.clientHeight };
    const next = revealViewport(viewport, size, target.selection, target.neighbours);
    if (next.x !== viewport.x || next.y !== viewport.y) mover.move(next, true);
  });
  useEffect(() => {
    if (selectionKey === null) return;
    // A new selection can open the details panel. The panel group sizes the canvas in the same
    // frame, so the reveal measures the canvas in the next frame.
    const frame = requestAnimationFrame(() => reveal());
    return () => cancelAnimationFrame(frame);
  }, [selectionKey]);
};
