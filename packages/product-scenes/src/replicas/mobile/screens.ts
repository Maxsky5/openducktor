// The navigation of the screens of MobileScreen.tsx in the display of an Android phone, as the
// native stack of react-native-screens moves them with the `ios_from_right` animation of
// src/navigation/stack-theme.ts: a pushed screen, or the full-screen camera, slides in from the
// right edge over its parent, which moves 30% to the left, and a pop moves both back. A workflow
// sheet, which the app presents as a full-screen modal on Android (fullSheetOptions of
// src/navigation/sheet-options.ts), fades in and out in 150 ms. The slide and the fade take the
// accelerate_decelerate interpolator. While the primary action of a sheet runs, the sheet is busy
// until it closes. A host switch replaces the screens at once: the root layout of
// src/app/_layout.tsx mounts a new navigator for the connection, so the next screen covers the old
// one in the same frame.
import { must } from "../../motion/dom";
import { fadeHide } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";

/** Seconds that a push or a pop takes: `config_shortAnimTime` of rns_ios_from_right_*.xml. */
const SLIDE = 0.2;

/**
 * The accelerate_decelerate interpolator of the slide and of the fade, a cosine curve. An Android
 * animation without an interpolator takes it.
 */
const ANDROID_EASE = "sine.inOut";

/** How far the parent of a pushed screen moves to the left, in percent of its width. */
const PARENT_SHIFT = -30;

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
        gsap.fromTo(
          top,
          { xPercent: 100 },
          { xPercent: 0, duration: SLIDE, ease: ANDROID_EASE, clearProps: clear },
        ),
      );
      scene.run(
        gsap.to(below, {
          xPercent: PARENT_SHIFT,
          duration: SLIDE,
          ease: ANDROID_EASE,
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
          { xPercent: PARENT_SHIFT },
          { xPercent: 0, duration: SLIDE, ease: ANDROID_EASE, clearProps: clear },
        ),
      );
      scene.run(
        gsap.to(top, {
          xPercent: 100,
          duration: SLIDE,
          ease: ANDROID_EASE,
          onComplete: () => {
            top.hidden = true;
            gsap.set(top, { clearProps: clear });
          },
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
          { autoAlpha: 1, duration: FADE, ease: ANDROID_EASE, clearProps: clear },
        ),
      );
    });
    return at + FADE;
  };

  /** Closes the full sheet `sheet` at `at`: it fades out. Returns the end of the fade. */
  const dismiss = (sheet: string, at: number): number => {
    scene.at(at, () => {
      scene.run(fadeHide(screen(sheet), FADE, ANDROID_EASE));
    });
    return at + FADE;
  };

  /**
   * The primary action `button` of the full sheet `sheet` runs from `at`: the button shows its
   * progress, and the sheet disables its other controls, as WorkflowSheet.tsx shows `data-busy`.
   * The sheet stays busy until it closes or another step takes its place.
   */
  const busy = (sheet: string, button: HTMLElement, at: number): void =>
    scene.at(at, () => {
      button.toggleAttribute("data-loading", true);
      screen(sheet).toggleAttribute("data-busy", true);
    });

  /** Replaces `current` with `next` at once at `at`, as the app does when it switches the host. */
  const replace = (current: string, next: string, at: number): number => {
    scene.at(at, () => {
      screen(next).hidden = false;
      screen(current).hidden = true;
    });
    return at;
  };

  /** Sets the color of the status bar icons at `at`. */
  const bar = (colors: "dark" | "light", at: number): void =>
    scene.at(at, () => {
      display.dataset.bar = colors;
    });

  return { screen, only, push, pop, present, dismiss, busy, replace, bar };
}
