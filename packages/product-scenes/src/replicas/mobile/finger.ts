// The touch of Touch.tsx in the display of a phone. A tap shows the touch over the target, then
// presses the target with the press feedback of Touchable in apps/mobile/src/ui/touchable.tsx:
// buttons and cards scale to 97 percent, rows show the strong fill under their content, and plain
// text and icon controls dim to 40 percent. The feedback comes in 110 ms when the finger presses,
// and goes in 240 ms when it lifts. A control names its feedback in `data-feedback`, on the target
// or on a parent of it: `none` for a control without feedback, such as a text field or a segment.
// A control inside such a parent names its own feedback. A control without the hook on it or on a
// parent scales.
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

/** PRESS_DURATION of touchable.tsx: the feedback comes in `motion.press` and goes in 240 ms. */
const PRESS = { in: 0.11, out: 0.24 };

/**
 * The pressed and the resting look of each feedback of touchable.tsx. A row shows the strong fill
 * through the `--press` property of Touch.css.
 */
const FEEDBACK = {
  scale: { pressed: { scale: 0.97 }, rest: { scale: 1 }, props: "scale" },
  opacity: { pressed: { opacity: 0.4 }, rest: { opacity: 1 }, props: "opacity" },
  highlight: { pressed: { "--press": 1 }, rest: { "--press": 0 }, props: "--press" },
  none: null,
} as const satisfies Record<
  string,
  { pressed: gsap.TweenVars; rest: gsap.TweenVars; props: string } | null
>;

type Feedback = keyof typeof FEEDBACK;

const isFeedback = (value: string): value is Feedback =>
  Object.keys(FEEDBACK).some((feedback) => feedback === value);

/** The control that a tap presses, and its feedback. */
type PressedControl = { control: HTMLElement; feedback: Feedback };

/** The control that a tap on `target` presses, and its feedback. */
function pressedControl(target: HTMLElement): PressedControl {
  const control = target.closest<HTMLElement>("[data-feedback]");
  if (!control) return { control: target, feedback: "scale" };
  const feedback = control.dataset.feedback ?? "";
  if (!isFeedback(feedback)) throw new Error(`The app has no press feedback ${feedback}.`);
  return { control, feedback };
}

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
      const touch = gsap
        .timeline()
        .fromTo(finger, { autoAlpha: 0, scale: 1.25 }, { autoAlpha: 1, scale: 1, duration: 0.12 })
        .to(finger, { scale: 0.9, duration: 0.1, ease: EASE.gentle }, press)
        .to(finger, { autoAlpha: 0, duration: LIFT, ease: EASE.exit }, press + TAP - LIFT);
      const { control, feedback } = pressedControl(target);
      const look = FEEDBACK[feedback];
      if (look) {
        touch
          .to(control, { ...look.pressed, duration: PRESS.in, ease: EASE.gentle }, press)
          .to(
            control,
            { ...look.rest, duration: PRESS.out, ease: EASE.gentle, clearProps: look.props },
            press + TAP,
          );
      }
      scene.run(touch);
    });
    return at + TAP;
  };

  return { tap };
}
