// The fake pointer of a replica: Pointer.astro draws the cursor and its click ring.
import { must } from "../../motion/dom";
import { offsetIn, type Point } from "../../motion/offset";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

function centerIn(element: HTMLElement, root: HTMLElement): Point {
  const point = offsetIn(element, root);
  return { x: point.x + element.offsetWidth / 2, y: point.y + element.offsetHeight / 2 };
}

/**
 * The pointer steps of one replica root. `find` returns the target when the step starts, so the
 * pointer follows the layout of that frame.
 */
export function pointer(scene: Scene, root: HTMLElement) {
  const cursor = must(root, "[data-cursor]", SVGSVGElement);
  const ring = must(root, "[data-click-ring]");

  /** Moves the pointer to the center of the target. Returns the arrival time. */
  const point = (find: () => HTMLElement, at: number, travel = 0.9): number => {
    scene.at(at, () => {
      const target = centerIn(find(), root);
      // A hidden pointer comes in from below and to the right of the target.
      if (Number(gsap.getProperty(cursor, "opacity")) <= 0.5)
        gsap.set(cursor, { x: target.x + 90, y: target.y + 70 });
      scene.run(gsap.to(cursor, { autoAlpha: 1, duration: 0.2 }));
      scene.run(
        gsap.to(cursor, { x: target.x - 4, y: target.y - 3, duration: travel, ease: EASE.travel }),
      );
    });
    return at + travel;
  };

  /** Moves the pointer to the target and clicks it. Returns the time of the click. */
  const click = (find: () => HTMLElement, at: number, travel = 0.9): number => {
    const clicked = point(find, at, travel);
    scene.at(clicked, () => {
      const target = find();
      const center = centerIn(target, root);
      gsap.set(ring, { x: center.x, y: center.y });
      scene.run(
        gsap.fromTo(
          ring,
          { autoAlpha: 0.7, scale: 0.3 },
          { autoAlpha: 0, scale: 1.4, duration: 0.5, ease: EASE.enter },
        ),
      );
      scene.run(
        gsap.fromTo(cursor, { scale: 1 }, { scale: 0.82, duration: 0.09, yoyo: true, repeat: 1 }),
      );
      scene.run(
        gsap.fromTo(target, { scale: 1 }, { scale: 0.96, duration: 0.09, yoyo: true, repeat: 1 }),
      );
    });
    return clicked;
  };

  /** Fades the pointer out. */
  const hide = (at: number): void => {
    scene.timeline.to(cursor, { autoAlpha: 0, duration: 0.3 }, at);
  };

  return { point, click, hide };
}

export type Pointer = ReturnType<typeof pointer>;
