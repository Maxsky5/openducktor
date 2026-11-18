// The keys that the visitor holds or presses during a scene. They are a part of the demonstration,
// like the pointer, so the app shows no such display. Two displays show them: Keystrokes.tsx over
// the bottom of a session window, and KeyHud.tsx over the stage of a website scene. Each display
// shows key caps, and a key that goes down dips once.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds of the dip of a key that goes down, and back up. */
const DIP = 0.08;

/** Seconds that the display of a window takes to show at the first key, and to hide. */
const HOLD = { in: 0.12, out: 0.18 } as const;

/** Seconds that the keys of a press on a stage take to fade in and to fade out. */
const PRESS = { in: 0.18, out: 0.25 } as const;

/**
 * Seconds of a quick press on a stage: the keys fade in, hold, and fade out, so they show for 0.3 s
 * in all and leave the next step, such as the text that follows, clear.
 */
const TAP = { in: 0.08, hold: 0.12, out: 0.1 } as const;

/** The key caps of `keys`, in the order that the app writes them. */
function capsOf(keys: readonly string[]): HTMLElement[] {
  return keys.map((key) => {
    const cap = document.createElement("kbd");
    cap.textContent = key;
    return cap;
  });
}

/** The caps go down by `depth` pixels and come back up, `stagger` seconds apart. */
function dip(caps: readonly HTMLElement[], depth: number, stagger = 0): gsap.core.Tween {
  return gsap.fromTo(
    caps,
    { y: 0, scale: 1 },
    { y: depth, scale: 0.94, duration: DIP, yoyo: true, repeat: 1, stagger, ease: EASE.gentle },
  );
}

/** The held keys of the Keystrokes display in the window `root`, and the steps that change them. */
export function heldKeys(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-keystrokes]");
  const tray = must(display, "[data-keystrokes-tray]");
  /** The keys that are down after the last step, in the order of the steps. */
  let down: readonly string[] = [];

  /**
   * From `at`, the visitor holds `keys`, in the order that the app writes them. A key that was not
   * down goes down, and a key that is not in `keys` goes up. The first key shows the display. The
   * steps read the keys that are down at build time, so call them in time order.
   */
  const hold = (keys: readonly string[], at: number): void => {
    const opens = down.length === 0;
    const pressed = keys.filter((key) => !down.includes(key));
    down = keys;
    scene.at(at, () => {
      const caps = capsOf(keys);
      tray.replaceChildren(...caps);
      if (opens) {
        display.hidden = false;
        scene.run(
          gsap.fromTo(
            tray,
            { autoAlpha: 0, y: 8 * designPixel(tray) },
            { autoAlpha: 1, y: 0, duration: HOLD.in, ease: EASE.enter, overwrite: true },
          ),
        );
      }
      const dipped = caps.filter((_, index) => pressed.includes(keys[index] ?? ""));
      if (dipped.length > 0) scene.run(dip(dipped, 3 * designPixel(tray)));
    });
  };

  /** Every key goes up at `at`, and the display hides. */
  const release = (at: number): void => {
    down = [];
    scene.at(at, () => {
      scene.run(
        gsap.to(tray, {
          autoAlpha: 0,
          duration: HOLD.out,
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

/** The key presses of the KeyHud display on the stage of `scene`. */
export function keyPresses(scene: Scene) {
  const hud = must(scene.stage, "[data-keys]");

  /** Shows the keys of one press at `at`. They fade in for `fade` seconds and dip once. */
  const show = (keys: readonly string[], at: number, fade: number): void =>
    scene.at(at, () => {
      const caps = capsOf(keys);
      hud.replaceChildren(...caps);
      hud.hidden = false;
      scene.run(
        gsap.fromTo(
          hud,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: fade, ease: EASE.arrive, overwrite: true },
        ),
      );
      scene.run(dip(caps, 3, 0.05));
    });

  /** Fades the keys out from `at` for `fade` seconds. */
  const hide = (at: number, fade: number): void =>
    scene.at(at, () => {
      scene.run(gsap.to(hud, { autoAlpha: 0, duration: fade, ease: EASE.exit }));
    });

  return {
    /** Shows the keys of one press at `at`, and fades them out at `until`. */
    press: (keys: readonly string[], at: number, until = at + 0.8): void => {
      show(keys, at, PRESS.in);
      hide(until, PRESS.out);
    },
    /** Shows the keys of one quick press at `at`. They are gone 0.3 s later. */
    tap: (keys: readonly string[], at: number): void => {
      show(keys, at, TAP.in);
      hide(at + TAP.in + TAP.hold, TAP.out);
    },
  };
}
