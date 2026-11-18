// The start dialog of StartDialog.tsx with Goal mode: the visitor turns the switch on, the goal
// field opens with the default goal, and Customize first message closes. Generate goal replaces the
// text with the goal that a model writes. Start session disables the form, then the dialog shows
// the startup progress. The session start modal unmounts when the session is ready, so the dialog
// goes at once.
import { must } from "../../motion/dom";
import { scrollToEnd } from "../../motion/effects";
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
  const startButton = must(overlay, "[data-start]");
  /** The buttons that start the session: Run in background and Start session. */
  const starts = [must(overlay, "[data-background]"), startButton];

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
   * The visitor clicks Generate goal at `at`. Until `ready`, the button shows the spinner, and the
   * start waits for the goal: Run in background and Start session are disabled. At `ready`, the
   * goal of the model replaces the text at once, as a new value of the textarea does. Returns the
   * time of the click.
   */
  const generateGoal = (at: number, ready: number, goal: string): number => {
    const clicked = cursor.click(() => generate, at, 0.8);
    const setBusy = (busy: boolean): void => {
      generate.toggleAttribute("data-busy", busy);
      for (const button of starts) button.toggleAttribute("data-disabled", busy);
    };
    scene.at(clicked, () => setBusy(true));
    scene.at(ready, () => {
      setBusy(false);
      text.textContent = goal;
      text.scrollTop = 0;
    });
    return clicked;
  };

  /**
   * The visitor clicks Start session at `at`. The form is disabled, and Start session shows
   * Starting… until the first startup snapshot of the host, `wait` seconds later. Then the dialog
   * shows the startup progress. Returns the time of the click.
   */
  const start = (at: number, wait: number): number => {
    const clicked = cursor.click(() => startButton, at, 0.9);
    dialog.start(clicked, clicked + wait);
    return clicked;
  };

  return {
    open: dialog.open,
    turnOn,
    generateGoal,
    start,
    step: dialog.setStep,
    close: dialog.unmount,
  };
}
