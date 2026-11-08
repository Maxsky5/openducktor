// The steps that the dialogs with the startup progress share: the New session dialog, the Fork
// session dialog, and the start dialog with Goal mode. The dialog opens over a window, its body
// scrolls, its submit button shows the spinner, the dialog narrows to the startup progress, each
// step changes its state, and the dialog closes when the session is ready.
import { all, must } from "../../motion/dom";
import { scrollToEnd } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { modal } from "./modal";
import type { StepState } from "./StartupProgress";

/**
 * The shared steps of the dialog `overlay` in the window `root`. With `attach`, the overlay is a
 * template that the open appends.
 */
export function progressDialog(
  scene: Scene,
  root: HTMLElement,
  overlay: HTMLElement,
  options: { attach?: boolean } = {},
) {
  const { box, open, close } = modal(scene, root, overlay, options);
  const count = must(box, "[data-step-count]");
  const step = (id: string): HTMLElement => must(box, `[data-step="${id}"]`);

  /** Build time: the dialog is closed, and each step is pending. */
  const reset = (): void => {
    overlay.hidden = true;
    for (const row of all(box, "[data-step]")) row.dataset.state = "pending";
    count.textContent = "0";
  };

  /** Scrolls the body of the dialog to its end from `at`. Returns the end time. */
  const scrollBody = (at: number, duration = 0.6): number => {
    const body = must(box, "[data-dialog-body]");
    scene.at(at, () => scene.run(scrollToEnd(body, duration)));
    return at + duration;
  };

  /** The dialog narrows to the startup progress at `at`. */
  const progress = (at: number): void =>
    scene.at(at, () => {
      const from = { width: box.offsetWidth, height: box.offsetHeight };
      box.scrollTop = 0;
      box.toggleAttribute("data-progress", true);
      const to = { width: box.offsetWidth, height: box.offsetHeight };
      scene.run(
        gsap.fromTo(box, from, {
          ...to,
          duration: 0.3,
          ease: EASE.move,
          clearProps: "width,height",
        }),
      );
    });

  /**
   * The submit button disables the form and shows the spinner at `at`. At `progressAt`, the dialog
   * narrows to the startup progress.
   */
  const start = (at: number, progressAt: number): void => {
    scene.at(at, () => box.toggleAttribute("data-starting", true));
    progress(progressAt);
  };

  /** Sets the state of the step `id` at `at`, and counts the completed steps. */
  const setStep = (id: string, state: StepState, at: number): void =>
    scene.at(at, () => {
      step(id).dataset.state = state;
      count.textContent = String(all(box, '[data-step][data-state="completed"]').length);
    });

  /**
   * Runs the steps of a new worktree from `at`: the checkout, the upstream of the branch, and the
   * session, which takes `sessionSeconds`. Returns the time when the session is ready.
   */
  const runSteps = (at: number, sessionSeconds: number): number => {
    setStep("checkout", "running", at);
    setStep("checkout", "completed", at + 0.9);
    setStep("upstream", "running", at + 0.9);
    setStep("upstream", "completed", at + 1.3);
    setStep("session", "running", at + 1.3);
    setStep("session", "completed", at + 1.3 + sessionSeconds);
    return at + 1.3 + sessionSeconds;
  };

  return { box, reset, open, close, scrollToEnd: scrollBody, progress, start, setStep, runSteps };
}
