// The goal row of GoalRow.tsx: it rises out of the composer when a goal starts, and its status
// changes with the goal that the runtime reports.
import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import {
  GOAL_STATUS_ICONS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_TONES,
  type GoalStatus,
} from "./GoalRow";

/** Seconds that the row takes to rise: --queue-open. */
const OPEN = 0.35;

/** The goal row in `root`. */
export function goalRow(scene: Scene, root: HTMLElement) {
  const row = must(root, "[data-goal-row]");
  const label = must(row, "[data-goal-status]");

  const setStatus = (status: GoalStatus): void => {
    row.dataset.status = status;
    row.dataset.tone = GOAL_STATUS_TONES[status];
    row.dataset.icon = GOAL_STATUS_ICONS[status];
    label.textContent = GOAL_STATUS_LABELS[status];
  };

  /** Build time: the session has no goal yet. */
  const reset = (status: GoalStatus): void => {
    row.hidden = true;
    setStatus(status);
  };

  /** The row rises out of the composer and its blur clears, as css-presence does on entry. */
  const show = (at: number): void =>
    scene.at(at, () => {
      row.hidden = false;
      const blur = 2 * designPixel(root);
      scene.run(
        gsap.fromTo(
          row,
          { height: 0, marginBottom: 0, opacity: 0, filter: `blur(${blur}px)` },
          {
            height: "auto",
            marginBottom: -6 * designPixel(root),
            opacity: 1,
            filter: "blur(0px)",
            duration: OPEN,
            ease: EASE.enter,
            clearProps: "height,marginBottom,filter",
          },
        ),
      );
    });

  /**
   * The runtime reports a new status. The label changes, and its color and the color of the icon
   * fade to the new tone, as the color transition of agent-chat-goal-row.css does.
   */
  const status = (at: number, next: GoalStatus): void => scene.at(at, () => setStatus(next));

  return { row, reset, show, status };
}
