// The Sessions tab of SessionsTab.tsx and the Needs you badge of its tab bar. The list follows the
// read model of the app, as the session list of the desktop sidebar does: a session that needs you
// goes to Needs you, a running one goes to Running, and the others go to Recent. The rows also
// show the card and the title colors of the app, and the badge counts Needs you and hides at 0.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { type NavEntry, navGroupViews } from "../shell/nav";
import { sessionList } from "../shell/nav-list";
import { rowSurface, titleTone } from "./session-entry";

/** Shows the card and the title colors of `entry` on its row. */
function render(item: HTMLElement, entry: NavEntry): void {
  const row = must(item, "[data-nav-row]");
  row.dataset.surface = rowSurface(entry);
  row.dataset.title = titleTone(entry);
}

/** The Sessions tab in `root`, and the steps that change it. */
export function sessionGroups(scene: Scene, root: HTMLElement) {
  const tab = must(root, '[data-screen="sessions"]');
  const badge = must(tab, "[data-tab-badge]");
  const badges = (entries: readonly NavEntry[]): void => {
    const needsYou = navGroupViews(entries).find((view) => view.group === "needs_you");
    const count = needsYou?.count ?? 0;
    badge.hidden = count === 0;
    badge.textContent = String(count);
  };
  return sessionList(scene, tab, { render, badges });
}
