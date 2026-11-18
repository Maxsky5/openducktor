// The keystrokes of a scene in KeyHud.tsx: each press shows its keys, which dip as
// they go down, then fade out.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds that the keys of a press take to fade in and to fade out. */
const PRESS = { in: 0.18, out: 0.25 } as const;

/**
 * Seconds of a quick press: the keys fade in, hold, and fade out, so they show for 0.3 s in all
 * and leave the next step, such as the text that follows, clear.
 */
const TAP = { in: 0.08, hold: 0.12, out: 0.1 } as const;

/** The key presses of the overlay. */
export type Keystrokes = {
  /** Shows the keys of one press at `at`, and fades them out at `until`. */
  press: (keys: readonly string[], at: number, until?: number) => void;
  /** Shows the keys of one quick press at `at`. They are gone 0.3 s later. */
  tap: (keys: readonly string[], at: number) => void;
};

/** The key overlay of the stage of `scene`. */
export function keystrokes(scene: Scene): Keystrokes {
  const hud = must(scene.stage, "[data-keys]");

  /** Shows the keys of one press at `at`. They fade in for `fade` seconds and dip once. */
  const show = (keys: readonly string[], at: number, fade: number): void =>
    scene.at(at, () => {
      hud.replaceChildren(
        ...keys.map((key) => {
          const cap = document.createElement("kbd");
          cap.textContent = key;
          return cap;
        }),
      );
      hud.hidden = false;
      scene.run(
        gsap.fromTo(
          hud,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: fade, ease: EASE.arrive, overwrite: true },
        ),
      );
      scene.run(
        gsap.fromTo(
          hud.children,
          { y: 0, scale: 1 },
          {
            y: 3,
            scale: 0.94,
            duration: 0.08,
            yoyo: true,
            repeat: 1,
            stagger: 0.05,
            ease: EASE.gentle,
          },
        ),
      );
    });

  /** Fades the keys out from `at` for `fade` seconds. */
  const hide = (at: number, fade: number): void =>
    scene.at(at, () => {
      scene.run(gsap.to(hud, { autoAlpha: 0, duration: fade, ease: EASE.exit }));
    });

  const press = (keys: readonly string[], at: number, until = at + 0.8): void => {
    show(keys, at, PRESS.in);
    hide(until, PRESS.out);
  };

  const tap = (keys: readonly string[], at: number): void => {
    show(keys, at, TAP.in);
    hide(at + TAP.in + TAP.hold, TAP.out);
  };

  return { press, tap };
}
