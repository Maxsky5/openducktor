// The Kanban sidebar of Sidebar.astro: the counters of the agent activity.
import { must } from "../../motion/dom";
import { pop } from "../../motion/effects";
import type { Scene } from "../../motion/scene";

/** Shows `value` in the sidebar counter `name`, and marks its row while it is above zero. */
export function countActivity(
  scene: Scene,
  root: HTMLElement,
  name: "sessions" | "waiting",
  value: number,
  at: number,
): void {
  const counter = must(root, `[data-count="${name}"]`);
  const row = must(root, `[data-activity-row="${name}"]`);
  scene.at(at, () => {
    counter.textContent = String(value);
    row.toggleAttribute("data-active", value > 0);
    scene.run(pop(counter, 1.3));
  });
}
