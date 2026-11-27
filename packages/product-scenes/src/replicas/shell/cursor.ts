// The fake pointer of a replica: Pointer.tsx draws the cursor and its click ring.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { offsetIn, type Point } from "../../motion/offset";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The tip of the arrow from the corner of its box, in CSS pixels. Each step puts it on its target. */
const POINTER_TIP = { x: 4, y: 3 } as const;

/**
 * The press of the pointer in a click and in a drag. The buttons of the app have no press scale, so
 * only the pointer squashes, and every gesture of a scene squashes it the same way.
 */
const PRESS = { scale: 0.82, duration: 0.09 } as const;

/**
 * A drag of the pointer, which its start function gives when the pointer presses: its end, its
 * ease, and the part of the view that follows it.
 */
export type Drag = {
  /** The place of the tip at the end of the drag: a point of the root, or the center of an element. */
  to: Point | HTMLElement;
  /** The curve of the move. The default is the travel of the pointer. */
  ease?: string;
  /**
   * Moves the dragged part with the pointer. Each frame of the move gives it the eased progress,
   * from 0 to 1.
   */
  onMove?: (progress: number) => void;
  /** Runs when the pointer releases at the end of the move. */
  onRelease?: () => void;
};

function centerIn(element: HTMLElement, root: HTMLElement): Point {
  const point = offsetIn(element, root);
  return { x: point.x + element.offsetWidth / 2, y: point.y + element.offsetHeight / 2 };
}

/** The place of a pointer target in `root`: a point of the root, or the center of an element. */
function placeOf(target: HTMLElement | Point, root: HTMLElement): Point {
  return target instanceof HTMLElement ? centerIn(target, root) : target;
}

/**
 * The pointer steps of one replica root. `find` returns the target when the step starts, so the
 * pointer follows the layout of that frame. A target is an element, whose center the pointer
 * takes, or a point of the root.
 */
export function pointer(scene: Scene, root: HTMLElement) {
  const cursor = must(root, "[data-cursor]", SVGSVGElement);
  const ring = must(root, "[data-click-ring]");

  /** Moves the pointer to the center of the target. Returns the arrival time. */
  const point = (find: () => HTMLElement | Point, at: number, travel = 0.9): number => {
    scene.at(at, () => {
      const target = placeOf(find(), root);
      // A hidden pointer comes in from below and to the right of the target, from a place inside
      // the window.
      if (Number(gsap.getProperty(cursor, "opacity")) <= 0.5) {
        const edge = 24 * designPixel(root);
        gsap.set(cursor, {
          x: Math.min(target.x + 90, root.clientWidth - edge),
          y: Math.min(target.y + 70, root.clientHeight - edge),
        });
      }
      scene.run(gsap.to(cursor, { autoAlpha: 1, duration: 0.2 }));
      scene.run(
        gsap.to(cursor, {
          x: target.x - POINTER_TIP.x,
          y: target.y - POINTER_TIP.y,
          duration: travel,
          ease: EASE.travel,
        }),
      );
    });
    return at + travel;
  };

  /** Moves the pointer to the target and clicks it. Returns the time of the click. */
  const click = (find: () => HTMLElement | Point, at: number, travel = 0.9): number => {
    const clicked = point(find, at, travel);
    scene.at(clicked, () => {
      const center = placeOf(find(), root);
      gsap.set(ring, { x: center.x, y: center.y });
      scene.run(
        gsap.fromTo(
          ring,
          { autoAlpha: 0.7, scale: 0.3 },
          { autoAlpha: 0, scale: 1.4, duration: 0.5, ease: EASE.enter },
        ),
      );
      scene.run(
        gsap.fromTo(
          cursor,
          { scale: 1 },
          { scale: PRESS.scale, duration: PRESS.duration, yoyo: true, repeat: 1 },
        ),
      );
    });
    return clicked;
  };

  /**
   * Presses the pointer where it is at `at`, moves its tip over `duration`, holds it `hold` more
   * seconds, and releases it. `start` runs once at the press: it measures the view and gives the
   * end of the move and the part that follows the pointer. The release is the drop, so a drop that
   * waits for its target to settle holds the pointer until then. Returns the time of the release.
   */
  const drag = (at: number, duration: number, start: () => Drag, hold = 0): number => {
    const released = at + duration + hold;
    let release: (() => void) | undefined;
    scene.at(at, () => {
      const { to, ease = EASE.travel, onMove, onRelease } = start();
      release = onRelease;
      const end = placeOf(to, root);
      scene.run(gsap.to(cursor, { scale: PRESS.scale, duration: PRESS.duration }));
      const move = gsap.to(cursor, {
        x: end.x - POINTER_TIP.x,
        y: end.y - POINTER_TIP.y,
        duration,
        ease,
        onUpdate: () => onMove?.(move.ratio),
      });
      scene.run(move);
    });
    scene.at(released, () => {
      scene.run(gsap.to(cursor, { scale: 1, duration: PRESS.duration }));
      release?.();
    });
    return released;
  };

  /** The place of the tip of the pointer in the root now. */
  const tip = (): Point => ({
    x: Number(gsap.getProperty(cursor, "x")) + POINTER_TIP.x,
    y: Number(gsap.getProperty(cursor, "y")) + POINTER_TIP.y,
  });

  /** True while the pointer shows. */
  const visible = (): boolean => Number(gsap.getProperty(cursor, "opacity")) > 0.5;

  /** Shows the crosshair of an element picker or of a line handle in place of the arrow. */
  const crosshair = (on: boolean): void => {
    if (on) cursor.dataset.shape = "crosshair";
    else delete cursor.dataset.shape;
  };

  /** Shows the I-beam in place of the arrow from `at` until `until`, while the tip is on text. */
  const textBeam = (at: number, until: number): void => {
    scene.at(at, () => {
      cursor.dataset.shape = "text";
    });
    scene.at(until, () => delete cursor.dataset.shape);
  };

  /** Fades the pointer out. */
  const hide = (at: number): void => {
    scene.timeline.to(cursor, { autoAlpha: 0, duration: 0.3 }, at);
  };

  return { point, click, drag, tip, visible, crosshair, textBeam, hide };
}

export type Pointer = ReturnType<typeof pointer>;
