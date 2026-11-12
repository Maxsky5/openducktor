// The touch of Touch.tsx in the display of a phone. A tap shows the touch over the target, then
// presses the target, as the scale feedback of Touchable in apps/mobile/src/ui/touchable.tsx.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds from the press of a tap to the release of the finger, when the app acts. */
const TAP = 0.3;

/** Seconds that the touch shows over the target before the press. */
const LEAD = 0.25;

/** Seconds that the touch takes to fade out. It is gone at the release. */
const LIFT = 0.15;

/** The taps of the phone in `root`. `find` returns the target when the touch shows. */
export function finger(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-display]");
  const finger = must(display, "[data-touch]");

  /**
   * Presses the center of the target at `at`. The touch shows over the target a moment before
   * and fades out by the release, so it never shows over the next screen. Returns the time of
   * the release.
   */
  const tap = (find: () => HTMLElement, at: number): number => {
    const shown = Math.max(0, at - LEAD);
    scene.at(shown, () => {
      const target = find();
      const point = offsetIn(target, display);
      gsap.set(finger, {
        x: point.x + target.offsetWidth / 2,
        y: point.y + target.offsetHeight / 2,
      });
      const press = at - shown;
      scene.run(
        gsap
          .timeline()
          .fromTo(finger, { autoAlpha: 0, scale: 1.25 }, { autoAlpha: 1, scale: 1, duration: 0.12 })
          .to(finger, { scale: 0.9, duration: 0.1, ease: EASE.gentle }, press)
          .to(finger, { autoAlpha: 0, duration: LIFT, ease: EASE.exit }, press + TAP - LIFT)
          .fromTo(
            target,
            { scale: 1 },
            { scale: 0.97, duration: 0.12, yoyo: true, repeat: 1, ease: EASE.gentle },
            press,
          ),
      );
    });
    return at + TAP;
  };

  return { tap };
}
