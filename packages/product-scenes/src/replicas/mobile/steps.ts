// The step list of MobileStage.tsx. The scene moves the highlight to each step as it plays it. A
// phone stage hides the list, and the steps still run.
import { all } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { StepState } from "./MobileStage";

/** The steps of the stage in `root`. */
export function stepList(scene: Scene, root: HTMLElement) {
  const steps = all(root, "[data-step-index]");

  const mark = (index: number): void => {
    steps.forEach((step, position) => {
      let state: StepState = "next";
      if (position < index) state = "done";
      else if (position === index) state = "current";
      step.dataset.state = state;
    });
  };

  /** Highlights step `index` at `at`. Step 0 is the first one. */
  const show = (index: number, at: number): void => scene.at(at, () => mark(index));

  /** Build time: highlights the first step. */
  mark(0);

  return { show };
}
