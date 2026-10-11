// The session list of Sidebar.astro and SidebarCollapsed.astro, and the badges of the workspace
// rail. The read model of the product regroups a session when it changes: a session that needs
// you goes to Needs you, a running one goes to Running, and the others go to Recent. The scenes
// change the entries, and the list and the rail follow them.
import { all, must } from "../../motion/dom";
import { growIn, pop, shrinkOut } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { WORKSPACES } from "../../sample/workspace";
import { statusPillLabel } from "../vocabulary";
import {
  type NavEntry,
  type NavGroupId,
  type NavPatch,
  navDot,
  navGroup,
  navGroupViews,
  navTime,
  navTone,
  railBadges,
} from "./nav";

const part = (item: HTMLElement, hook: string): HTMLElement | null => {
  const found = item.querySelector(`[data-${hook}]`);
  return found instanceof HTMLElement ? found : null;
};

/** Shows the state of `entry` on its element. The collapsed sidebar shows only the dot and the icon. */
function render(item: HTMLElement, entry: NavEntry): void {
  must(item, "[data-nav-dot]").dataset.dot = navDot(entry);
  const icon = must(item, "[data-nav-icon]");
  const tone = navTone(entry);
  if (tone) icon.dataset.tone = tone;
  else delete icon.dataset.tone;
  must(item, "[data-nav-row]").toggleAttribute("data-selected", entry.selected ?? false);
  const status = part(item, "nav-status");
  if (status) {
    status.hidden = !entry.status;
    if (entry.status) {
      status.dataset.status = entry.status;
      status.textContent = statusPillLabel(entry.status, true);
    }
  }
  const attention = part(item, "nav-attention");
  if (attention) {
    attention.hidden = !entry.attention;
    attention.textContent = entry.attention ?? "";
  }
  const time = part(item, "nav-time");
  if (time) {
    const shown = navTime(entry);
    time.hidden = !shown;
    time.textContent = shown ?? "";
  }
  const commands = part(item, "nav-commands");
  if (commands) commands.hidden = !entry.commands;
}

/** The session list of the sidebar in `root`, and the steps that change it. */
export function sessionList(scene: Scene, root: HTMLElement) {
  const entries = new Map<string, NavEntry>();
  const element = (id: string): HTMLElement => must(root, `[data-nav-entry="${id}"]`);
  const list = (group: NavGroupId): HTMLElement => must(root, `[data-nav-list="${group}"]`);
  const known = (id: string): NavEntry => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`The sidebar has no session ${id}.`);
    return entry;
  };

  /** Counts the entries of each group. A changed count pops, and Recent hides when it is empty. */
  const recount = (animate: boolean): void => {
    for (const view of navGroupViews([...entries.values()])) {
      must(root, `[data-nav-group="${view.group}"]`).hidden = view.hidden;
      const count = must(root, `[data-nav-count="${view.group}"]`);
      const value = String(view.count);
      if (count.textContent === value) continue;
      count.textContent = value;
      if (animate) scene.run(pop(count, 1.3));
    }
  };

  /** Shows the badges of each workspace tile. A badge that turns on pops. */
  const showBadges = (animate: boolean): void => {
    for (const { name } of WORKSPACES) {
      const badges = railBadges([...entries.values()], name);
      for (const kind of ["input", "running"] as const) {
        const badge = must(root, `[data-rail-tile="${name}"] [data-rail-badge="${kind}"]`);
        if (badge.hidden !== badges[kind]) continue;
        badge.hidden = !badges[kind];
        if (animate && badges[kind]) scene.run(pop(badge, 1.5));
      }
    }
  };

  /**
   * Build time: shows `data` in their groups, in their order, with their state. A later entry and
   * the entries that `data` does not list hide until a step shows them.
   */
  const place = (data: readonly NavEntry[]): void => {
    entries.clear();
    for (const item of all(root, "[data-nav-entry]")) item.hidden = true;
    for (const entry of data) {
      entries.set(entry.id, entry);
      const item = element(entry.id);
      item.hidden = Boolean(entry.later);
      list(navGroup(entry)).append(item);
      render(item, entry);
    }
    recount(false);
    showBadges(false);
  };

  /** A copy of a shown entry takes its place and closes, so the entry can leave its group. */
  const closeCopy = (item: HTMLElement): void => {
    const copy = item.cloneNode(true);
    if (!(copy instanceof HTMLElement)) throw new Error("The session entry clone failed.");
    copy.removeAttribute("data-nav-entry");
    item.replaceWith(copy);
    scene.run(shrinkOut(copy, 0.3));
  };

  /**
   * Changes the entry `id` at `at`, and shows it if it hides. When its group changes, the old place
   * closes while the entry grows in at the top of its new group.
   */
  const update = (id: string, at: number, patch: NavPatch = {}): void =>
    scene.at(at, () => {
      const entry: NavEntry = { ...known(id), ...patch, later: false };
      entries.set(id, entry);
      const item = element(id);
      const group = list(navGroup(entry));
      const stays = !item.hidden && item.parentElement === group;
      if (!item.hidden && !stays) closeCopy(item);
      item.hidden = false;
      render(item, entry);
      if (!stays) {
        group.prepend(item);
        scene.run(growIn(item, 0.4));
      }
      recount(true);
      showBadges(true);
    });

  /**
   * Hides the entry `id` at `at`: a closed task leaves the list, and a task that groups its
   * sessions shows only its latest session. A later step can show the entry again.
   */
  const hide = (id: string, at: number): void =>
    scene.at(at, () => {
      const item = element(id);
      if (item.hidden) return;
      entries.set(id, { ...known(id), later: true });
      const group = item.parentElement;
      closeCopy(item);
      item.hidden = true;
      group?.append(item);
      recount(true);
      showBadges(true);
    });

  return { place, update, hide };
}
