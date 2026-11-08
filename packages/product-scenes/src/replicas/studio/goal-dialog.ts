// The start dialog of StartDialog.tsx with Goal mode: the visitor turns the switch on, the goal
// field opens with the default goal, and Customize first message closes. Generate goal replaces the
// text with the goal that a model writes. Start session shows the startup progress in the dialog,
// and the dialog closes when the session is ready.
import { must } from "../../motion/dom";
import { fadeIn, scrollToEnd } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/cursor";
import { progressDialog } from "./progress-dialog";

/** Seconds of the reveal of css-presence-reveal: 250 ms to open, 200 ms to close. */
const OPEN = 0.25;
const CLOSE = 0.2;

/**
 * The steps of the start dialog template `overlay` over the window `root`: the steps of
 * progress-dialog.ts, Goal mode, and Generate goal.
 */
export function goalDialog(scene: Scene, root: HTMLElement, cursor: Pointer, overlay: HTMLElement) {
  const dialog = progressDialog(scene, root, overlay, { attach: true });
  const { box } = dialog;
  const toggle = must(overlay, "[data-goal-switch]");
  const reveal = must(overlay, "[data-goal-reveal]");
  const kickoff = must(overlay, "[data-kickoff]");
  const text = must(overlay, "[data-goal-text]");
  const generate = must(overlay, "[data-generate]");

  /**
   * The visitor turns Goal mode on. The goal field opens, and Customize first message closes. A
   * short stage scrolls the dialog to the end of the field. Returns the time of the click.
   */
  const turnOn = (at: number): number => {
    const clicked = cursor.click(() => toggle, at, 0.8);
    scene.at(clicked, () => {
      toggle.toggleAttribute("data-checked", true);
      reveal.hidden = false;
      scene.run(
        gsap.fromTo(
          reveal,
          { height: 0, opacity: 0 },
          { height: "auto", opacity: 1, duration: OPEN, ease: EASE.enter, clearProps: "all" },
        ),
      );
      scene.run(
        gsap.to(kickoff, {
          height: 0,
          paddingTop: 0,
          opacity: 0,
          duration: CLOSE,
          ease: EASE.enter,
          onComplete: () => {
            kickoff.hidden = true;
            gsap.set(kickoff, { clearProps: "all" });
          },
        }),
      );
    });
    scene.at(clicked + OPEN + 0.05, () => {
      if (box.scrollHeight > box.clientHeight) scene.run(scrollToEnd(box, 0.5));
    });
    return clicked;
  };

  /**
   * The visitor clicks Generate goal at `at`. The button shows the spinner until `ready`, and the
   * goal of the model replaces the text. Returns the time of the click.
   */
  const generateGoal = (at: number, ready: number, goal: string): number => {
    const clicked = cursor.click(() => generate, at, 0.8);
    scene.at(clicked, () => generate.toggleAttribute("data-busy", true));
    scene.at(ready, () => {
      generate.removeAttribute("data-busy");
      text.textContent = goal;
      text.scrollTop = 0;
      scene.run(fadeIn(text, 0.3));
    });
    return clicked;
  };

  /** The visitor clicks Start session. Returns the time of the click. */
  const start = (at: number): number => cursor.click(() => must(overlay, "[data-start]"), at, 0.9);

  return {
    open: dialog.open,
    turnOn,
    generateGoal,
    start,
    progress: dialog.progress,
    step: dialog.setStep,
    close: dialog.close,
  };
}
