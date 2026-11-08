// The steps of the CI Checks tab of ChecksPanel.tsx: a read of the checks after Refresh CI checks,
// and a check row that opens. The tab reads the checks only when it opens and when you select
// Refresh, so each new state of a check shows after a read.
import { all, must } from "../../motion/dom";
import { pop } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { type CheckState, checkState, checksStatus, checksSummary } from "./model";

/** Seconds that a read of the pull request takes, while the refresh icon spins. */
const READ = 0.6;

/** The controller of the CI Checks tab in `root`, and of the dot on its tab. */
export function ciChecks(scene: Scene, root: HTMLElement) {
  const panel = must(root, '[data-panel="ci_checks"]');
  const dot = must(root, "[data-ci]");
  const button = must(panel, "[data-checks-refresh]");
  const badge = must(panel, "[data-checks-badge]");
  const row = (name: string): HTMLElement => must(panel, `[data-check="${name}"]`);

  /** Shows the checks of a read: the state of each row, the summary, the badge, and the dot. */
  const set = (states: Readonly<Record<string, CheckState>>, updated: string): void => {
    for (const [name, state] of Object.entries(states)) row(name).dataset.state = state;
    const shown = all(panel, "[data-check]").map((item) => checkState(item.dataset.state));
    const status = checksStatus(shown);
    panel.dataset.checks = status;
    dot.dataset.checks = status;
    must(panel, "[data-checks-summary]").textContent = checksSummary(shown);
    must(panel, "[data-checks-updated]").textContent = updated;
  };

  /**
   * Refresh CI checks reads the pull request again. The icon spins during the read, and the badge
   * pops when its status changes. Returns the end of the read.
   */
  const refresh = (
    at: number,
    states: Readonly<Record<string, CheckState>>,
    updated: string,
  ): number => {
    scene.at(at, () => button.toggleAttribute("data-spinning", true));
    scene.at(at + READ, () => {
      const before = panel.dataset.checks;
      button.removeAttribute("data-spinning");
      set(states, updated);
      if (panel.dataset.checks !== before) scene.run(pop(badge, 1.12));
    });
    return at + READ;
  };

  /** Opens or closes the rows of a check. */
  const open = (name: string, opened: boolean, at: number): void =>
    scene.at(at, () => row(name).toggleAttribute("data-open", opened));

  return { button, row, set, refresh, open };
}
