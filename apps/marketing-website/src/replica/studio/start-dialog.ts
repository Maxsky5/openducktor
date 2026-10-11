// The session start dialog of StartDialog.astro: it opens over a window, the visitor clicks one of
// its buttons, and it closes. The session page and the palette view start sessions with it.
import { must } from "../../motion/dom";
import { designPixel, fadeIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/pointer";

/**
 * Opens the start dialog `overlay` over `root` at `at`, clicks Start session, or Run in background
 * when `button` is "background", and closes the dialog. Returns the close time.
 */
export function startDialog(
  scene: Scene,
  root: HTMLElement,
  cursor: Pointer,
  overlay: HTMLElement,
  at: number,
  button: "start" | "background" = "start",
): number {
  const box = must(overlay, "[data-dialog-box]");
  scene.at(at, () => {
    root.append(overlay);
    scene.run(fadeIn(overlay, 0.25));
    scene.run(
      gsap.fromTo(
        box,
        { autoAlpha: 0, scale: 0.96, y: 8 * designPixel(root) },
        { autoAlpha: 1, scale: 1, y: 0, duration: 0.35, ease: EASE.arrive },
      ),
    );
  });
  const clicked = cursor.click(() => must(overlay, `[data-${button}]`), at + 1.1, 1);
  scene.at(clicked + 0.25, () =>
    scene.run(
      gsap.to(overlay, {
        autoAlpha: 0,
        duration: 0.25,
        ease: EASE.dismiss,
        onComplete: () => overlay.remove(),
      }),
    ),
  );
  return clicked + 0.5;
}
