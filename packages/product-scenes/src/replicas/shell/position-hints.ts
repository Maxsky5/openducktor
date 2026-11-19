// The position hints of PositionHint.tsx in a window. While the visitor holds Mod,
// usePositionHints of use-position-hints.ts sets data-shortcut-hints on the page root, and
// position-hints.css shows the hints after a delay. They show and hide at once, with no fade. A
// replica shows them with `data-hints` on its root.
import type { Scene } from "../../motion/scene";

/** Seconds that Mod stays down before the hints show: the transition-delay of position-hints.css. */
export const HINT_DELAY = 0.75;

/** The steps that show the position hints. */
type PositionHintSteps = {
  hold: (down: number, up: number) => number;
};

/** The position hints of the window `root`. */
export function positionHints(scene: Scene, root: HTMLElement): PositionHintSteps {
  /**
   * The visitor holds Mod from `down` to `up`. The hints show HINT_DELAY seconds after `down`, and
   * they hide at `up`. A shorter hold shows no hint, so a scene does not call this step for it.
   * Returns the time when the hints show.
   */
  const hold = (down: number, up: number): number => {
    const shown = down + HINT_DELAY;
    if (up <= shown) throw new Error("A hold of Mod shorter than the hint delay shows no hint.");
    scene.at(shown, () => root.toggleAttribute("data-hints", true));
    scene.at(up, () => root.removeAttribute("data-hints"));
    return shown;
  };

  return { hold };
}
