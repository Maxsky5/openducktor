// The controller of the viewport of Canvas.tsx: the fit of the workflow, the pan to a new
// selection, the moves of setViewport, and the "More below" control. The canvas holds its viewport
// in `--vx`, `--vy`, and `--zoom`, with `x` from its middle. The view gives the viewport of its
// markup, the last frame, in `--fit-x`, `--fit-y`, and `--fit-zoom`, and the viewport of the
// first frame in `--start-x`, `--start-y`, and `--start-zoom`, for each layout of its stage.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { EASE } from "../../motion/tokens";
import type { Box, Viewport } from "./model";
import {
  type CanvasSize,
  fitViewport,
  fromLeft,
  fromMiddle,
  HINT_ROOM,
  type RevealTarget,
  revealViewport,
  VIEWPORT_MOVE,
} from "./viewport";

export function canvasView(root: HTMLElement) {
  const canvas = must(root, "[data-canvas]");
  const moreBelow = must(canvas, "[data-more-below]");

  const canvasSize = (): CanvasSize => {
    const pixel = designPixel(root);
    return { width: canvas.offsetWidth / pixel, height: canvas.offsetHeight / pixel };
  };

  const read = (name: string): number =>
    Number.parseFloat(getComputedStyle(canvas).getPropertyValue(name)) || 0;

  /** The viewport that the canvas shows now. */
  const currentViewport = (): Viewport => ({
    x: read("--vx"),
    y: read("--vy"),
    zoom: read("--zoom") || 1,
  });

  /** The "More below" control shows while `content` reaches past the bottom at `viewport`. */
  const updateMoreBelow = (content: Box, viewport: Viewport): void => {
    const bottom = (content.y + content.height) * viewport.zoom + viewport.y;
    moreBelow.hidden = bottom - canvasSize().height + HINT_ROOM <= 0;
  };

  const vars = ({ x, y, zoom }: Viewport) => ({ "--vx": x, "--vy": y, "--zoom": zoom });

  /** The move of the viewport to `viewport`, as setViewport of React Flow with a duration. */
  const moveViewport = (viewport: Viewport, duration = VIEWPORT_MOVE): gsap.core.Tween =>
    gsap.to(canvas, { ...vars(viewport), duration, ease: EASE.move });

  /**
   * The viewport of the first frame, as the editor opens the workflow: the view fits it for the
   * layout of its stage in `--start-x`, `--start-y`, and `--start-zoom`, so the build measures no
   * layout.
   */
  const showStart = (): void => {
    canvas.style.setProperty("--vx", "var(--start-x)");
    canvas.style.setProperty("--vy", "var(--start-y)");
    canvas.style.setProperty("--zoom", "var(--start-zoom)");
  };

  /** The fit of `content` as a move, then the pan to the selection `target`. */
  const fitTo = (content: Box, target?: RevealTarget): gsap.core.Tween => {
    const viewport = fitViewport(content, canvasSize(), target);
    updateMoreBelow(content, viewport);
    return moveViewport(viewport);
  };

  /**
   * The pan to a new selection, as useRevealSelection of the editor: the smallest move that shows
   * it from the viewport that the canvas shows.
   */
  const revealTo = (content: Box, target: RevealTarget): gsap.core.Tween => {
    const size = canvasSize();
    const next = revealViewport(
      fromLeft(currentViewport(), size),
      size,
      target.selection,
      target.neighbours,
    );
    updateMoreBelow(content, next);
    return moveViewport(fromMiddle(next, size));
  };

  /** The move to the viewport of the markup, which the view fits for the layout of its stage. */
  const fitToMarkup = (content: Box, duration?: number): gsap.core.Tween => {
    const viewport = { x: read("--fit-x"), y: read("--fit-y"), zoom: read("--fit-zoom") || 1 };
    updateMoreBelow(content, viewport);
    return moveViewport(viewport, duration);
  };

  /**
   * Runs `change`, which changes the width of the canvas, as a panel does that opens or closes
   * beside it. The pan counts from the middle of the canvas, so it moves by half the change, and
   * the content keeps its place on screen until the viewport moves, as in React Flow.
   */
  const keepPlace = (change: () => void): void => {
    const before = canvas.offsetWidth;
    change();
    const shift = (canvas.offsetWidth - before) / 2 / designPixel(root);
    if (shift === 0) return;
    canvas.style.setProperty("--vx", String(currentViewport().x - shift));
  };

  return { showStart, fitTo, revealTo, fitToMarkup, keepPlace };
}

/** The viewport steps of the canvas of a root. */
export type CanvasView = ReturnType<typeof canvasView>;
