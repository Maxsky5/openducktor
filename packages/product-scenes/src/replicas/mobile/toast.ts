// The toast of MobileToast.tsx in the display of a phone, as feedback-host.tsx shows it: it comes
// in from above, stays for the default time of a toast, and fades out in 160 ms.
import { must } from "../../motion/dom";
import { fadeHide, riseIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds that a toast shows, as DEFAULT_DURATION_MS of feedback-store.ts. */
const TOAST = 4;

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
      scene.run(riseIn(element, -12, 0.4));
    });
    scene.at(at + TOAST, () => scene.run(fadeHide(element, EXIT, EASE.gentle)));
    return at + TOAST;
  };

  return { show };
}
