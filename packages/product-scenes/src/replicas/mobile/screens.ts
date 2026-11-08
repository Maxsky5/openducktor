// The navigation of the screens of MobileScreen.tsx in the display of an Android phone, as the
// native stack of react-native-screens moves them on Android 13 and later: a pushed screen, or the
// full-screen camera, comes in from 10% at the right and fades in fast over its parent, which moves
// 10% to the left. A workflow sheet, which the app presents as a full-screen modal on Android
// (fullSheetOptions of src/navigation/sheet-options.ts), fades in and out in 150 ms. A host switch
// replaces the screens at once.
import { must } from "../../motion/dom";
import { fadeHide } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds that a push or a pop takes: rns_default_enter_in and rns_default_exit_out. */
const SLIDE = 0.45;

/** Seconds that a full sheet fades in or out: rns_fade_in and rns_fade_out. */
const FADE = 0.15;

/** The screens of the phone in `root`, by their `data-screen` names. */
export function screens(scene: Scene, root: HTMLElement) {
  const display = must(root, "[data-display]");
  const screen = (id: string): HTMLElement => must(display, `[data-screen="${id}"]`);
  const clear = "transform,opacity,visibility";

  /** Build time: shows only the screens in `ids`. */
  const only = (...ids: string[]): void => {
    for (const element of display.querySelectorAll<HTMLElement>("[data-screen]"))
      element.hidden = !ids.includes(element.dataset.screen ?? "");
  };

  /** Pushes `next` over `current` at `at`. Returns the end of the move. */
  const push = (current: string, next: string, at: number): number => {
    scene.at(at, () => {
      const top = screen(next);
      const below = screen(current);
      top.hidden = false;
      scene.run(
        gsap
          .timeline()
          .fromTo(top, { xPercent: 10 }, { xPercent: 0, duration: SLIDE, ease: EASE.arrive }, 0)
          .fromTo(top, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08, ease: "none" }, 0.05)
          .set(top, { clearProps: clear }),
      );
      scene.run(
        gsap.to(below, {
          xPercent: -10,
          duration: SLIDE,
          ease: EASE.arrive,
          onComplete: () => {
            below.hidden = true;
            gsap.set(below, { clearProps: clear });
          },
        }),
      );
    });
    return at + SLIDE;
  };

  /** Pops `current` back to `previous` at `at`. Returns the end of the move. */
  const pop = (current: string, previous: string, at: number): number => {
    scene.at(at, () => {
      const top = screen(current);
      const below = screen(previous);
      below.hidden = false;
      scene.run(
        gsap.fromTo(
          below,
          { xPercent: -10 },
          { xPercent: 0, duration: SLIDE, ease: EASE.arrive, clearProps: clear },
        ),
      );
      scene.run(
        gsap
          .timeline()
          .to(top, { xPercent: 10, duration: SLIDE, ease: EASE.arrive }, 0)
          .to(top, { autoAlpha: 0, duration: 0.08, ease: "none" }, 0.035)
          .call(() => {
            top.hidden = true;
            gsap.set(top, { clearProps: clear });
          }),
      );
    });
    return at + SLIDE;
  };

  /** Presents the full sheet `sheet` at `at`: it fades in over the screen. Returns its end. */
  const present = (sheet: string, at: number): number => {
    scene.at(at, () => {
      const top = screen(sheet);
      top.hidden = false;
      scene.run(
        gsap.fromTo(
          top,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: FADE, ease: "none", clearProps: clear },
        ),
      );
    });
    return at + FADE;
  };

  /** Closes the full sheet `sheet` at `at`: it fades out. Returns the end of the fade. */
  const dismiss = (sheet: string, at: number): number => {
    scene.at(at, () => {
      scene.run(fadeHide(screen(sheet), FADE, EASE.steady));
    });
    return at + FADE;
  };

  /** Replaces `current` with `next` at `at`, as the app does when it switches the host. */
  const replace = (current: string, next: string, at: number): number => {
    scene.at(at, () => {
      screen(current).hidden = true;
      const shown = screen(next);
      shown.hidden = false;
      scene.run(
        gsap.fromTo(
          shown,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.25, ease: EASE.fade, clearProps: clear },
        ),
      );
    });
    return at + 0.25;
  };

  /** Sets the color of the status bar icons at `at`. */
  const bar = (colors: "dark" | "light", at: number): void =>
    scene.at(at, () => {
      display.dataset.bar = colors;
    });

  return { screen, only, push, pop, present, dismiss, replace, bar };
}
