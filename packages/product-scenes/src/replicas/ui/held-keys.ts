// The keys that the visitor holds, in the display of Keystrokes.tsx. The display shows the keys
// that are down, a key that goes down dips once, and the display hides when the last key goes up.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds that the display takes to show at the first key, and to hide after the last key. */
const FADE = { in: 0.12, out: 0.18 } as const;

/** Seconds of the dip of a key that goes down, and back up. */
const DIP = 0.08;

/** The key caps of the display in the window `root`, and the steps that change them. */
export function heldKeys(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-keystrokes]");
  const tray = must(display, "[data-keystrokes-tray]");
  /** The keys that are down after the last step, in the order of the steps. */
  let down: readonly string[] = [];

  const cap = (key: string): HTMLElement => {
    const element = document.createElement("kbd");
    element.textContent = key;
    return element;
  };

  /**
   * From `at`, the visitor holds `keys`, in the order that the app writes them. A key that was not
   * down goes down, and a key that is not in `keys` goes up. The first key shows the display.
   */
  const hold = (keys: readonly string[], at: number): void => {
    const opens = down.length === 0;
    const pressed = keys.filter((key) => !down.includes(key));
    down = keys;
    scene.at(at, () => {
      const caps = keys.map(cap);
      tray.replaceChildren(...caps);
      if (opens) {
        display.hidden = false;
        scene.run(
          gsap.fromTo(
            tray,
            { autoAlpha: 0, y: 8 * designPixel(tray) },
            { autoAlpha: 1, y: 0, duration: FADE.in, ease: EASE.enter, overwrite: true },
          ),
        );
      }
      const dipped = caps.filter((_, index) => pressed.includes(keys[index] ?? ""));
      if (dipped.length === 0) return;
      scene.run(
        gsap.fromTo(
          dipped,
          { y: 0, scale: 1 },
          {
            y: 3 * designPixel(tray),
            scale: 0.94,
            duration: DIP,
            yoyo: true,
            repeat: 1,
            ease: EASE.gentle,
          },
        ),
      );
    });
  };

  /** Every key goes up at `at`, and the display hides. */
  const release = (at: number): void => {
    down = [];
    scene.at(at, () => {
      scene.run(
        gsap.to(tray, {
          autoAlpha: 0,
          duration: FADE.out,
          ease: EASE.exit,
          overwrite: true,
          onComplete: () => {
            display.hidden = true;
            tray.replaceChildren();
          },
        }),
      );
    });
  };

  return { hold, release };
}
