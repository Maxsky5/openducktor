import { isUserStartedTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { ResolvedPanelTab } from "./session-panel-layout";

/**
 * The open state of the bottom panel of an owner. All views of the owner share it.
 *
 * - `default`: no saved state, so the panel follows the default rule.
 * - `closed`: the panel is closed.
 * - `open`: the panel is open. It hides while the host closes its last tabs.
 * - `restoring`: the record of an earlier run saved the panel open, and no view showed it yet. The
 *   panel waits for a tab, because the tabs of an earlier run can be gone.
 * - `open_while_closing`: the user or an action opened the panel while the host closed its last
 *   tabs. The panel shows, and it stays open when the close ends.
 */
export type BottomPanelState = "default" | "closed" | "open" | "restoring" | "open_while_closing";

/** The state that a saved record gives. */
export const bottomStateFromSaved = (saved: boolean | null): BottomPanelState => {
  if (saved === null) return "default";
  return saved ? "restoring" : "closed";
};

/** The value that the record saves for a state. Null: the record saves no value. */
export const savedBottomOpen = (state: BottomPanelState): boolean | null => {
  switch (state) {
    case "default":
      return null;
    case "closed":
      return false;
    case "open":
    case "restoring":
    case "open_while_closing":
      return true;
  }
};

/**
 * The last check of the rules by the shown view of an owner. Only that view reads it, so a change
 * does not render the other views.
 */
export type BottomPanelCheck = {
  /** The bottom tabs, shown or closing. */
  tabCount: number;
  /** Whether the rules opened the panel. */
  wasOpen: boolean;
};

export const NO_BOTTOM_CHECK: BottomPanelCheck = { tabCount: 0, wasOpen: false };

/**
 * The terminal list of the page for the owner. `other_owner`: the list still belongs to the owner
 * that the page showed before.
 */
export type TerminalListStatus = "other_owner" | "loading" | "synced" | "failed";

/** What a view knows about the bottom panel of its owner in one render. */
export type BottomPanelFacts = {
  /** The shown bottom tabs. */
  tabs: readonly ResolvedPanelTab[];
  /** The bottom tabs that hide while the host closes them. A failed close shows them again. */
  closingTabs: readonly ResolvedPanelTab[];
  terminalList: TerminalListStatus;
};

/** The decision of the shown view for one render. */
export type BottomPanelDecision = {
  isShown: boolean;
  /** The panel closes by itself, so it slides out. */
  hides: boolean;
  /** The next state. It is the given state when nothing changes. */
  state: BottomPanelState;
  /** The next check. It is the given check when nothing changes. */
  check: BottomPanelCheck;
};

/** The tabs that a restore can show. A saved browser entry waits for the browser list. */
const confirmedTabCount = (tabs: readonly ResolvedPanelTab[]): number =>
  tabs.filter((tab) => tab.kind !== "browser" || tab.tab !== null).length;

const hasOnlyClosingTabs = ({ tabs, closingTabs }: BottomPanelFacts): boolean =>
  tabs.length === 0 && closingTabs.length > 0;

/** Whether the panel is open with `tabs`, before the hide of a panel whose last tabs close. */
const opensWith = (
  state: BottomPanelState,
  facts: BottomPanelFacts,
  tabs: readonly ResolvedPanelTab[],
): boolean => {
  switch (state) {
    case "default":
      // Browser tabs go to the bottom panel only after a user action, so they show it like the
      // terminals that the user started.
      return tabs.some(
        (tab) =>
          tab.kind === "browser" || (tab.kind === "terminal" && isUserStartedTab(tab.terminal)),
      );
    case "closed":
      return false;
    case "open":
    case "open_while_closing":
      return true;
    case "restoring":
      return confirmedTabCount(tabs) > 0 || facts.terminalList === "failed";
  }
};

/**
 * Whether the bottom panel shows. The panel hides while the host closes its last tabs, unless the
 * user asked to show it during the close. Every view of the owner uses this rule.
 */
export const isBottomPanelShown = (state: BottomPanelState, facts: BottomPanelFacts): boolean =>
  (state === "open_while_closing" || !hasOnlyClosingTabs(facts)) &&
  opensWith(state, facts, facts.tabs);

/** The state after the user or an action opens or closes the panel. */
export const bottomStateAfterChoice = (
  isOpen: boolean,
  facts: BottomPanelFacts,
): BottomPanelState => {
  if (!isOpen) return "closed";
  return hasOnlyClosingTabs(facts) ? "open_while_closing" : "open";
};

/**
 * Applies the automatic rules. Only the shown view of an owner calls it, so a kept view never saves
 * a state behind the back of the user.
 *
 * - A restore opens the panel when it has a confirmed tab or the terminal list fails. It closes the
 *   panel when the synced terminal list gives no tab and no tab waits for a list or closes.
 * - An open panel that loses its last tab closes. A tab that closes counts until it leaves. A panel
 *   that the user opened during the close stays open.
 * - A closed panel that loses its last tab keeps its state, so the default rule stays.
 *
 * The check and the lost-tab rule apply only while the terminal list of the owner is synced. A list
 * that loads, as after a return to the page, has no tabs yet, and does not lose them.
 */
export const decideBottomPanel = (
  state: BottomPanelState,
  check: BottomPanelCheck,
  facts: BottomPanelFacts,
): BottomPanelDecision => {
  const { tabs, closingTabs, terminalList } = facts;
  let next = state;
  if (next === "restoring" && opensWith(next, facts, tabs)) next = "open";
  if (next === "open_while_closing" && tabs.length > 0) next = "open";
  if (terminalList !== "synced") {
    return { isShown: isBottomPanelShown(next, facts), hides: false, state: next, check };
  }
  const tabCount = tabs.length + closingTabs.length;
  const lostLastTab =
    check.tabCount > 0 && tabCount === 0 && check.wasOpen && next !== "open_while_closing";
  const restoreFindsNoTab = next === "restoring" && tabCount === 0;
  const hides = lostLastTab || restoreFindsNoTab;
  if (hides) next = "closed";
  // While only closing tabs remain, the rules judge them, as the panel showed them before.
  const wasOpen = opensWith(next, facts, tabs.length > 0 ? tabs : closingTabs);
  const nextCheck =
    tabCount === check.tabCount && wasOpen === check.wasOpen ? check : { tabCount, wasOpen };
  return { isShown: isBottomPanelShown(next, facts), hides, state: next, check: nextCheck };
};
