// The startup card of StartupCard.tsx at the top of a transcript: it comes in with the first
// message, each step changes its state, the visitor can open the details of a step, and a clean
// start folds the card to its title row when the session is ready.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { StepState } from "./StartupProgress";

/** inline-startup-enter of inline-session-startup.css: 180 ms, from 4 pixels higher. */
const ENTER = { duration: 0.18, rise: 4 } as const;

/** The steps of the startup card in `root`. */
export function startupCard(scene: Scene, root: HTMLElement) {
  const owner = must(root, "[data-startup-card]");
  const box = must(owner, "[data-startup-box]");
  const count = must(box, "[data-step-count]");
  const step = (id: string): HTMLElement => must(box, `[data-step="${id}"]`);

  /** Build time: the card waits for the first message, open, with each step pending. */
  const reset = (): void => {
    owner.hidden = true;
    box.dataset.phase = "running";
    box.toggleAttribute("data-open", true);
    for (const row of all(box, "[data-step]")) {
      row.dataset.state = "pending";
      row.removeAttribute("data-open");
    }
    for (const details of all(box, "[data-step-details]")) details.hidden = true;
    count.textContent = "0";
  };

  /** The card comes in at `at` with a short fade and fall. */
  const show = (at: number): void =>
    scene.at(at, () => {
      owner.hidden = false;
      scene.run(
        gsap.fromTo(
          owner,
          { autoAlpha: 0, y: -ENTER.rise * designPixel(root) },
          {
            autoAlpha: 1,
            y: 0,
            duration: ENTER.duration,
            ease: EASE.glide,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });

  /** Sets the state of the step `id` at `at`, and counts the completed steps. */
  const setStep = (id: string, state: StepState, at: number): void =>
    scene.at(at, () => {
      step(id).dataset.state = state;
      count.textContent = String(all(box, '[data-step][data-state="completed"]').length);
    });

  /** The step `id` runs from `at` for `seconds`. Returns the time when it completes. */
  const runStep = (id: string, at: number, seconds: number): number => {
    setStep(id, "running", at);
    setStep(id, "completed", at + seconds);
    return at + seconds;
  };

  /** The row of the step `id`. */
  const row = (id: string): HTMLElement => must(step(id), "[data-step-row]");

  /** The chevron at the end of the row of the step `id`, for the pointer. */
  const chevron = (id: string): HTMLElement => must(step(id), "[data-step-chevron]");

  /**
   * The pointer is over the row of the step `id` from `at` until `until`, and a click at `click`
   * opens its details: the chevron turns, and the details show under the row.
   */
  const openDetails = (id: string, at: number, click: number, until: number): void => {
    scene.at(at, () => row(id).toggleAttribute("data-hover", true));
    scene.at(click, () => {
      step(id).toggleAttribute("data-open", true);
      must(step(id), "[data-step-details]").hidden = false;
    });
    scene.at(until, () => row(id).removeAttribute("data-hover"));
  };

  /** The session is ready at `at`: the check and the close button show, and the card folds. */
  const ready = (at: number): void =>
    scene.at(at, () => {
      box.dataset.phase = "ready";
      box.removeAttribute("data-open");
    });

  return { reset, show, runStep, chevron, openDetails, ready };
}
