// The startup notification of StartupToast.tsx: it slides into the toast stack, its steps change
// their state, and the ready session shows its check and Open. The notification is a template, or
// the ready notification of the last frame, which the scene hides at build time.
import { all, must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { StepState } from "../studio/StartupProgress";

/** The steps that move a startup notification. */
type StartupToastSteps = {
  hide: () => void;
  show: (at: number) => void;
  setStep: (id: string, state: StepState, at: number) => void;
  ready: (at: number) => void;
};

/** The steps of the startup notification `toast` in the toast stack `stack`. */
export function startupToast(
  scene: Scene,
  stack: HTMLElement,
  toast: HTMLElement,
): StartupToastSteps {
  const count = toast.querySelector<HTMLElement>("[data-step-count]");

  /** Build time: a notification of the markup leaves the stack, and its steps are pending. */
  const hide = (): void => {
    toast.remove();
    toast.dataset.phase = "running";
    for (const row of all(toast, "[data-step]")) row.dataset.state = "pending";
    if (count) count.textContent = "0";
  };

  /** Slides the notification in at `at`. */
  const show = (at: number): void =>
    scene.at(at, () => {
      stack.append(toast);
      scene.run(
        gsap.fromTo(
          toast,
          { autoAlpha: 0, y: 18, scale: 0.98 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: EASE.arrive },
        ),
      );
    });

  /** Sets the state of the step `id` at `at`, and counts the completed steps. */
  const setStep = (id: string, state: StepState, at: number): void =>
    scene.at(at, () => {
      must(toast, `[data-step="${id}"]`).dataset.state = state;
      if (count)
        count.textContent = String(all(toast, '[data-step][data-state="completed"]').length);
    });

  /** The session is ready at `at`: the check, the close button, and Open show. */
  const ready = (at: number): void =>
    scene.at(at, () => {
      toast.dataset.phase = "ready";
    });

  return { hide, show, setStep, ready };
}
