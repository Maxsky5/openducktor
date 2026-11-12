// The goal row of GoalRow.tsx: it rises out of the composer when a goal starts, its status changes
// with the goal that the runtime reports, and a click opens or closes the whole objective.
import { must } from "../../motion/dom";
import { designPixel, pop } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import {
  GOAL_STATUS_ICONS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_TONES,
  type GoalStatus,
} from "./GoalRow";

/** Seconds that the row takes to rise and to close the objective: --queue-open and --queue-close. */
const OPEN = 0.35;
const CLOSE = 0.25;

/** The goal row in `root`. */
export function goalRow(scene: Scene, root: HTMLElement) {
  const row = must(root, "[data-goal-row]");
  const line = must(row, "[data-goal-line]");
  const chevron = must(row, "[data-goal-chevron]", SVGSVGElement);
  const label = must(row, "[data-goal-status]");

  const setStatus = (status: GoalStatus): void => {
    row.dataset.status = status;
    row.dataset.tone = GOAL_STATUS_TONES[status];
    row.dataset.icon = GOAL_STATUS_ICONS[status];
    label.textContent = GOAL_STATUS_LABELS[status];
  };
  const setExpanded = (expanded: boolean): void => {
    line.dataset.expanded = String(expanded);
    chevron.dataset.expanded = String(expanded);
  };

  /** Build time: the session has no goal yet, and the row is closed. */
  const reset = (status: GoalStatus): void => {
    row.hidden = true;
    setStatus(status);
    setExpanded(false);
    line.dataset.clamped = "true";
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

  /** The runtime reports a new status. The label and its color change together. */
  const status = (at: number, next: GoalStatus): void =>
    scene.at(at, () => {
      setStatus(next);
      scene.run(pop(label, 1.08));
    });

  /** A click opens the whole objective. The ellipsis goes first, so the words wrap as it grows. */
  const expand = (at: number): void =>
    scene.at(at, () => {
      line.dataset.clamped = "false";
      setExpanded(true);
    });

  /** A click closes the objective. It gets its ellipsis when the height transition ends. */
  const collapse = (at: number): void => {
    scene.at(at, () => setExpanded(false));
    scene.at(at + CLOSE, () => {
      line.dataset.clamped = "true";
    });
  };

  return { row, toggle: must(row, "[data-goal-toggle]"), reset, show, status, expand, collapse };
}
