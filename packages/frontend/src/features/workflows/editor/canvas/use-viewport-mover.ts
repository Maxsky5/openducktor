import { useReactFlow, type Viewport } from "@xyflow/react";
import { useMemo, useRef } from "react";

/** The length of an animated move, such as the pan to a selection or the fit after a resize. */
const VIEWPORT_MOVE_MS = 200;

/** Moves the viewport of the canvas, and knows where a running move ends. */
export type ViewportMover = {
  /** The end of the move that runs, or the viewport that the canvas shows. */
  target(): Viewport;
  move(next: Viewport, animate: boolean): void;
};

/**
 * One owner of the moves of the canvas viewport. A move that starts while another runs plans from
 * the end of the running one, so two moves never fight, such as the fit after the details panel
 * opens and the pan to the new selection.
 */
export const useViewportMover = (): ViewportMover => {
  const { getViewport, setViewport } = useReactFlow();
  const running = useRef<{ readonly viewport: Viewport; readonly until: number } | null>(null);
  return useMemo(
    () => ({
      target: () => {
        const move = running.current;
        // A pan of the user stops a running move, so a move counts only while it can still run.
        return move !== null && performance.now() < move.until ? move.viewport : getViewport();
      },
      move: (next, animate) => {
        if (!animate) {
          running.current = null;
          void setViewport(next);
          return;
        }
        const move = { viewport: next, until: performance.now() + VIEWPORT_MOVE_MS };
        running.current = move;
        void setViewport(next, { duration: VIEWPORT_MOVE_MS }).then(() => {
          if (running.current === move) running.current = null;
        });
      },
    }),
    [getViewport, setViewport],
  );
};
