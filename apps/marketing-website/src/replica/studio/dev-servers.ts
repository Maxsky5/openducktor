// The dev servers of DevServerPanel.astro: the terminal tabs, their status dots and logs, and the
// actions of the panel.
import { all, data, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";

/** The status of a dev server, as the dot of its tab shows it. */
export type DevServerStatus = "stopped" | "starting" | "running";

/** The dev server panel in `root`, and the steps that change it. */
export function devServerPanel(scene: Scene, root: HTMLElement) {
  const panel = must(root, "[data-dev]");
  const start = must(panel, "[data-start]");
  const actions = all(panel, "[data-dev-action]");
  const tabs = all(panel, "[data-tab]");
  const tab = (id: string): HTMLElement => must(panel, `[data-tab="${id}"]`);
  const lines = (id: string): HTMLElement[] =>
    all(must(panel, `[data-content="${id}"]`), "[data-dev-line]");

  /** Opens the terminal of the dev server `id`. */
  const select = (id: string): void => {
    for (const item of tabs) {
      const selected = data(item, "tab") === id;
      item.toggleAttribute("data-active", selected);
      must(panel, `[data-content="${data(item, "tab")}"]`).hidden = !selected;
    }
  };
  /** Stop and Restart are disabled while a script starts. */
  const setPending = (pending: boolean): void => {
    for (const action of actions) action.toggleAttribute("data-disabled", pending);
  };
  const setStatus = (id: string, status: DevServerStatus): void => {
    must(tab(id), "[data-dot]").dataset.status = status;
  };
  /** Shows the log lines of the dev server `id`, one at each time of `times`. */
  const print = (id: string, times: number[]): void => {
    lines(id).forEach((line, index) => {
      const at = times[index];
      if (at === undefined) throw new Error(`The ${id} log has no time for line ${index + 1}.`);
      scene.at(at, () => {
        line.hidden = false;
      });
    });
  };

  return {
    panel,
    start,
    ids: tabs.map((item) => data(item, "tab")),
    tab,
    lines,
    select,
    setPending,
    setStatus,
    print,
  };
}
