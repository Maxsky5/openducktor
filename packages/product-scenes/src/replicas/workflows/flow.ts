// The controller of the content of the workflow canvas of Canvas.tsx: the state boxes, the lines
// and their labels, the emphasis of the selection, and the line of a new transition that follows
// the pointer. The canvas scales its content, so a pointer target inside it goes through `aim`,
// which gives its place on screen. canvas-view.ts moves the viewport.
import { all, must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Pointer } from "../shell/cursor";
import { EASE } from "../../motion/tokens";
import type { Point } from "../../motion/offset";
import {
  ARROW,
  type Box,
  type CanvasFrame,
  type Emphasis,
  type LineRoute,
  STATE_BOX,
} from "./model";
import { alignTo, polylineOf, roundedPath } from "./viewport";

/** The emphasis of each box and line of the canvas, by its id. Missing ones show as normal. */
export type EmphasisMap = Readonly<Record<string, Emphasis>>;

/** Seconds that the pointer holds a new line over its target box before it drops it. */
const DROP_HOLD = 0.12;

/**
 * The path of the line of a new transition, as getBezierPath of React Flow draws it from the
 * bottom of a box to a point that the line enters from the top: each control point takes half the
 * height between the ends.
 */
function bezierDown(from: Point, to: Point): string {
  const offset = Math.abs(to.y - from.y) / 2;
  return `M ${from.x},${from.y} C ${from.x},${from.y + offset} ${to.x},${to.y - offset} ${to.x},${to.y}`;
}

function inside(point: Point, box: Box): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** The canvas of `root`, with `cursor`, the pointer of the root. */
export function workflowFlow(root: HTMLElement, cursor: Pointer) {
  const canvas = must(root, "[data-canvas]");
  const connection = must(canvas, "[data-connection]", SVGPathElement);
  const node = (id: string): HTMLElement => must(canvas, `[data-node="${id}"]`);
  const line = (id: string): SVGPathElement => must(canvas, `[data-line="${id}"]`, SVGPathElement);
  const label = (id: string): HTMLElement => must(canvas, `[data-label="${id}"]`);
  const dot = (id: string, side: string): HTMLElement =>
    must(node(id), `.wfe-node-dot[data-side="${side}"]`);

  /** The scale of the stage over the layout, for a page or a film that scales the scene. */
  const scale = (): number => {
    const width = root.getBoundingClientRect().width;
    return width > 0 && root.offsetWidth > 0 ? width / root.offsetWidth : 1;
  };

  /** The place of `element` in the layout of `root`, from its box on screen. */
  const placeIn = (element: Element): Box => {
    const outer = root.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const ratio = scale();
    return {
      x: (box.left - outer.left) / ratio - root.clientLeft,
      y: (box.top - outer.top) / ratio - root.clientTop,
      width: box.width / ratio,
      height: box.height / ratio,
    };
  };

  /** The pointer target of an element that the canvas scales: the center of its box on screen. */
  const aim = (element: Element): Point => {
    const box = placeIn(element);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  /**
   * The pointer target of an empty place of the canvas, at a part of its width and its height,
   * such as 0.9 and 0.45.
   */
  const aimAt = (across: number, down: number): Point => {
    const box = placeIn(canvas);
    return { x: box.x + box.width * across, y: box.y + box.height * down };
  };

  const setVars = (element: HTMLElement, values: Readonly<Record<string, number>>): void => {
    for (const [name, value] of Object.entries(values))
      element.style.setProperty(name, String(value));
  };

  const place = (id: string, at: Point): void => setVars(node(id), { "--x": at.x, "--y": at.y });

  /** The move of a box to `at`. */
  const glide = (id: string, at: Point, duration = 0.3): gsap.core.Tween =>
    gsap.to(node(id), { "--x": at.x, "--y": at.y, duration, ease: EASE.move });

  /** Gives a line the path and the label box of `route`. */
  const route = (id: string, { path, label: box }: LineRoute): void => {
    line(id).setAttribute("d", path);
    setVars(label(id), { "--lx": box.x, "--ly": box.y, "--lw": box.width });
  };

  /**
   * The move of a line to `next`, in the time and the ease of the boxes that it links: its corners
   * go to their new places, and its label glides with it.
   */
  const morph = (id: string, next: LineRoute, duration = 0.3): gsap.core.Timeline => {
    const path = line(id);
    const target = polylineOf(next.path);
    const from = alignTo(polylineOf(path.getAttribute("d") ?? next.path), target);
    const progress = { value: 0 };
    return gsap
      .timeline()
      .to(progress, {
        value: 1,
        duration,
        ease: EASE.move,
        onUpdate: () => {
          const points = target.map((to, index) => {
            const start = from[index] ?? to;
            return {
              x: gsap.utils.interpolate(start.x, to.x, progress.value),
              y: gsap.utils.interpolate(start.y, to.y, progress.value),
            };
          });
          path.setAttribute("d", roundedPath(points));
        },
        onComplete: () => path.setAttribute("d", next.path),
      })
      .to(
        label(id),
        {
          "--lx": next.label.x,
          "--ly": next.label.y,
          "--lw": next.label.width,
          duration,
          ease: EASE.move,
        },
        0,
      );
  };

  /** Shows or hides a line and its label. */
  const showLine = (id: string, shown: boolean): void => {
    line(id).toggleAttribute("hidden", !shown);
    label(id).hidden = !shown;
  };

  /** A line without a trigger is dotted, and its label is dashed with a warning. */
  const setTriggered = (id: string, triggered: boolean): void => {
    line(id).toggleAttribute("data-untriggered", !triggered);
    label(id).toggleAttribute("data-untriggered", !triggered);
  };

  /** Sets the emphasis of the boxes and the lines. An emphasized line has the selection arrow. */
  const emphasize = (map: EmphasisMap): void => {
    for (const element of all(canvas, "[data-node], [data-label]")) {
      const id = element.dataset.node ?? element.dataset.label ?? "";
      element.dataset.emphasis = map[id] ?? "normal";
    }
    for (const path of all(canvas, "[data-line]", SVGPathElement)) {
      const emphasis = map[path.dataset.line ?? ""] ?? "normal";
      path.dataset.emphasis = emphasis;
      const strong = emphasis === "selected" || emphasis === "related";
      path.setAttribute("marker-end", `url(#${strong ? ARROW.emphasized : ARROW.normal})`);
    }
  };

  /** Shows the grips at the ends of the selected line, or hides them. */
  const showGrips = (shown: boolean): void => {
    for (const grip of all(canvas, "[data-grip]")) grip.hidden = !shown;
  };

  /** The pointer rests on a box: its border darkens and its connection dots show. */
  const hover = (id: string, on: boolean): void => {
    node(id).toggleAttribute("data-hover", on);
  };

  /**
   * The user drags a new transition from the bottom dot of the box at `from` onto box `to` in
   * `duration` seconds from `at`. The line follows the pointer as a curve, and it ends on the top
   * of the box under the pointer, which shows that a drop links to it. Returns the drop time.
   */
  const drag = (
    from: Point,
    to: { id: string; at: Point },
    at: number,
    duration: number,
  ): number => {
    const start = { x: from.x + STATE_BOX.width / 2, y: from.y + STATE_BOX.height };
    const target: Box = { ...to.at, ...STATE_BOX };
    const end = { x: target.x + STATE_BOX.width / 2, y: target.y + STATE_BOX.height / 2 };
    const entry = { x: target.x + STATE_BOX.width / 2, y: target.y };
    return cursor.drag(
      at,
      duration,
      () => {
        const box = node(to.id);
        const topDot = dot(to.id, "top");
        connection.toggleAttribute("data-dragging", true);
        connection.setAttribute("d", bezierDown(start, start));
        return {
          to: aim(box),
          onMove: (progress) => {
            const point = {
              x: gsap.utils.interpolate(start.x, end.x, progress),
              y: gsap.utils.interpolate(start.y, end.y, progress),
            };
            // The box under the pointer shows its dots, and the dot of its side that the line
            // enters takes the selection colour, as React Flow marks the target of a drop.
            const over = inside(point, target);
            box.toggleAttribute("data-drop", over);
            box.toggleAttribute("data-hover", over);
            topDot.toggleAttribute("data-active", over);
            connection.setAttribute("d", bezierDown(start, over ? entry : point));
          },
          onRelease: () => {
            connection.removeAttribute("data-dragging");
            box.removeAttribute("data-drop");
            box.removeAttribute("data-hover");
            topDot.removeAttribute("data-active");
          },
        };
      },
      DROP_HOLD,
    );
  };

  /**
   * The first frame: the boxes and the lines of `frame` at their places, without a selection. The
   * box of `newState` and the line of `newLine`, which the user adds later, do not show, and the
   * line has no trigger yet, as a line that the user draws.
   */
  const reset = (frame: CanvasFrame, newState: string, newLine: string): void => {
    for (const [id, at] of Object.entries(frame.positions)) place(id, at);
    for (const [id, next] of Object.entries(frame.routes)) route(id, next);
    node(newState).hidden = true;
    showLine(newLine, false);
    setTriggered(newLine, false);
    emphasize({});
    showGrips(false);
  };

  return {
    reset,
    node,
    label,
    dot,
    aim,
    aimAt,
    place,
    glide,
    route,
    morph,
    showLine,
    setTriggered,
    emphasize,
    showGrips,
    hover,
    drag,
  };
}
