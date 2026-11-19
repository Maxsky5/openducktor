// The steps of the startup progress of StartupTrace.tsx in a start sheet, as startup-trace.tsx and
// startup-step-row.tsx in apps/mobile/src/features/session-startup move it. The progress takes the
// place of the form at once. When a step or the phase changes, SwapTransition of
// swap-transition.tsx in apps/mobile/src/ui rolls its content: the old content leaves 6 points
// upward in `motion.press`, 110 ms, while the new content rises 6 points into its place in
// `motion.base`, 240 ms.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT } from "./app-motion";
import type { StartupStepState } from "./StartupTrace";

/** SWAP_DISTANCE, SWAP_LEAVE, and SWAP_ENTERING of swap-transition.tsx. */
const SWAP = { distance: 6, leave: 0.11, enter: 0.24 };

/** The steps that change the startup progress. */
type StartProgressSteps = {
  show: (at: number, states: Readonly<Record<string, StartupStepState>>) => void;
  set: (id: string, state: StartupStepState, at: number) => void;
  ready: (at: number) => void;
};

/** The startup progress in the start sheet `sheet`. */
export function startProgress(scene: Scene, sheet: HTMLElement): StartProgressSteps {
  const trace = must(sheet, "[data-startup]");
  const step = (id: string): HTMLElement => must(trace, `[data-startup-step="${id}"]`);

  /** Rolls from the content `from` to the content `to` in their place. Runs in a change. */
  const roll = (from: HTMLElement, to: HTMLElement): void => {
    const unit = designPixel(trace);
    const clear = "opacity,visibility,transform";
    scene.run(
      gsap.fromTo(
        from,
        { autoAlpha: 1, y: 0 },
        {
          autoAlpha: 0,
          y: -SWAP.distance * unit,
          duration: SWAP.leave,
          ease: APP_EASE_OUT,
          clearProps: clear,
        },
      ),
    );
    scene.run(
      gsap.fromTo(
        to,
        { autoAlpha: 0, y: SWAP.distance * unit },
        { autoAlpha: 1, y: 0, duration: SWAP.enter, ease: APP_EASE_OUT, clearProps: clear },
      ),
    );
  };

  /**
   * The progress takes the place of the form at `at`, with the states of the steps in the first
   * snapshot of the host. The first content of a SwapTransition does not roll.
   */
  const show = (at: number, states: Readonly<Record<string, StartupStepState>>): void =>
    scene.at(at, () => {
      for (const [id, state] of Object.entries(states)) step(id).dataset.state = state;
      sheet.toggleAttribute("data-progress", true);
    });

  /** The step `id` takes the state `state` at `at`, and its icon rolls. */
  const set = (id: string, state: StartupStepState, at: number): void =>
    scene.at(at, () => {
      const row = step(id);
      const from = must(row, `[data-icon="${row.dataset.state}"]`);
      row.dataset.state = state;
      roll(from, must(row, `[data-icon="${state}"]`));
    });

  /** The session is ready at `at`: the icon and the name of the phase roll to Session ready. */
  const ready = (at: number): void =>
    scene.at(at, () => {
      trace.dataset.phase = "ready";
      roll(must(trace, '[data-phase-icon="running"]'), must(trace, '[data-phase-icon="ready"]'));
      roll(must(trace, '[data-phase-title="running"]'), must(trace, '[data-phase-title="ready"]'));
    });

  return { show, set, ready };
}
