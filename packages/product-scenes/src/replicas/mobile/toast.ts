// The toast of MobileToast.tsx in the display of a phone, as feedback-host.tsx shows it: it comes
// in from 25 dp above with a fade, stays for the default time of a toast, and fades out in 160 ms.
import { must } from "../../motion/dom";
import { designPixel, fadeHide, riseIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds that a toast shows, as DEFAULT_DURATION_MS of feedback-store.ts. */
const TOAST = 4;

/** Seconds that a toast takes to come in: the spring of TOAST_ENTERING of feedback-host.tsx. */
const ENTER = 0.38;

/** The start offset of FadeInUp of Reanimated, in dp above the place of the toast. */
const DROP = 25;

/** Seconds that a toast takes to fade out: TOAST_EXITING of feedback-host.tsx. */
const EXIT = 0.16;

/** The toast `name` of the phone in `root`. It is hidden at the start. */
export function toast(scene: Scene, root: HTMLElement, name: string) {
  const element = must(root, `[data-toast="${name}"]`);
  element.hidden = true;

  /** Shows the toast at `at`. Returns the time when the toast starts to go. */
  const show = (at: number): number => {
    scene.at(at, () => {
      element.hidden = false;
      scene.run(riseIn(element, -DROP * designPixel(element), ENTER));
    });
    scene.at(at + TOAST, () => scene.run(fadeHide(element, EXIT, EASE.gentle)));
    return at + TOAST;
  };

  return { show };
}
