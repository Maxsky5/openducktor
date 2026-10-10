import { agentRoleValues } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { TerminalTab } from "@/features/terminals";
import {
  PANEL_TAB_KIND_RULES,
  type PanelId,
  type PanelTabKind,
  type SessionOwnerKind,
  TOOL_TAB_KINDS,
  type ToolTabKind,
} from "./panel-tab-kinds";

export type SessionPanelOwner =
  | { kind: "task"; workspaceId: string; taskId: string }
  | { kind: "chat"; workspaceId: string; sessionId: string };

/** Each task role remembers its own selected right panel tab. A chat has one selection. */
export type SessionPanelSelectionKey = AgentRole | "chat";

export const SESSION_PANEL_SELECTION_KEYS = [
  ...agentRoleValues,
  "chat",
] as const satisfies readonly SessionPanelSelectionKey[];

type PanelEntries = { right: PanelTabEntry[]; bottom: PanelTabEntry[] };

type ToolTabEntry = { id: ToolTabKind; kind: ToolTabKind };
type TerminalTabEntry = {
  id: string;
  kind: "terminal";
  /** The terminal tab that this entry shows. Reconcile updates it when the tab ID changes. */
  tabId: string;
  terminalId: string | null;
};
type NewTabEntry = { id: string; kind: "new_tab" };
export type PanelTabEntry = ToolTabEntry | TerminalTabEntry | NewTabEntry;

export type SessionPanelLayout = {
  panels: PanelEntries;
  /** Default-open kinds that the user closed. Reconcile does not open them again. */
  closedKinds: ToolTabKind[];
  /**
   * Key: selection key. Value: the remembered entry ID, or null when the remembered tab closed.
   * A key without a value has no selection yet and uses the default tab of its role.
   */
  selectedRight: Partial<Record<SessionPanelSelectionKey, string | null>>;
  selectedBottom: string | null;
};

export type ResolvedPanelTab =
  | { id: string; kind: ToolTabKind }
  | { id: string; kind: "terminal"; terminal: TerminalTab }
  | { id: string; kind: "new_tab" };

/** The live facts that decide which entries a layout keeps and shows. */
export type SessionPanelContext = {
  ownerKind: SessionOwnerKind;
  selectionKey: SessionPanelSelectionKey;
  /** Kinds that the rules allow but that the page cannot show now, such as CI Checks without a pull request. */
  unavailableKinds: ReadonlySet<ToolTabKind>;
  /** All terminal tabs of the owner, also the tabs that are closing. */
  terminalTabs: readonly TerminalTab[];
  closingTabIds: ReadonlySet<string>;
  /** True when `terminalTabs` shows the latest host list, so a missing tab means a closed terminal. */
  terminalTabsSynced: boolean;
};

export type PanelDropTarget = { id: string; position: "before" | "after" } | null;

/** Changes the stored layout of the current owner. The change gets the reconciled layout. */
export type SessionPanelLayoutUpdate = (
  mutate: (layout: SessionPanelLayout, context: SessionPanelContext) => SessionPanelLayout,
) => void;

const PANEL_IDS: readonly PanelId[] = ["right", "bottom"];

const DEFAULT_RIGHT_SELECTION = {
  spec: "document",
  planner: "document",
  build: "diffs",
  qa: "document",
  chat: "diffs",
} satisfies Record<SessionPanelSelectionKey, ToolTabKind>;

const rememberedRightTabId = (
  layout: SessionPanelLayout,
  selectionKey: SessionPanelSelectionKey,
): string | null => {
  const remembered = layout.selectedRight[selectionKey];
  return remembered === undefined ? DEFAULT_RIGHT_SELECTION[selectionKey] : remembered;
};

export const sessionPanelOwnerKey = (owner: SessionPanelOwner): string =>
  JSON.stringify([
    owner.workspaceId,
    owner.kind,
    owner.kind === "task" ? owner.taskId : owner.sessionId,
  ]);

export const emptySessionPanelLayout = (): SessionPanelLayout => ({
  panels: { right: [], bottom: [] },
  closedKinds: [],
  selectedRight: {},
  selectedBottom: null,
});

const terminalEntryId = (tabId: string): string => `terminal:${tabId}`;

const newTabEntryId = (panel: PanelId): string => `new_tab:${panel}`;

const canHoldKind = (kind: PanelTabKind, panel: PanelId, ownerKind: SessionOwnerKind): boolean => {
  const rule = PANEL_TAB_KIND_RULES[kind];
  return rule.panels.some((id) => id === panel) && rule.owners.some((id) => id === ownerKind);
};

const isEntryOfTab = (
  entry: TerminalTabEntry,
  tab: Pick<TerminalTab, "tabId" | "terminalId">,
): boolean =>
  entry.tabId === tab.tabId || (entry.terminalId !== null && entry.terminalId === tab.terminalId);

const findEntryTab = (
  entry: TerminalTabEntry,
  tabs: readonly TerminalTab[],
): TerminalTab | undefined =>
  tabs.find((tab) => tab.tabId === entry.tabId) ??
  (entry.terminalId === null ? undefined : tabs.find((tab) => tab.terminalId === entry.terminalId));

const bindTerminalEntry = (entry: TerminalTabEntry, tab: TerminalTab): TerminalTabEntry => {
  const terminalId = tab.terminalId ?? entry.terminalId;
  if (entry.tabId === tab.tabId && entry.terminalId === terminalId) return entry;
  return { ...entry, tabId: tab.tabId, terminalId };
};

const newTerminalEntry = (tab: Pick<TerminalTab, "tabId" | "terminalId">): TerminalTabEntry => ({
  id: terminalEntryId(tab.tabId),
  kind: "terminal",
  tabId: tab.tabId,
  terminalId: tab.terminalId,
});

const sameItems = <Value>(left: readonly Value[], right: readonly Value[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameSelection = (
  left: SessionPanelLayout["selectedRight"],
  right: SessionPanelLayout["selectedRight"],
): boolean => SESSION_PANEL_SELECTION_KEYS.every((key) => left[key] === right[key]);

/**
 * Applies the current rules to a layout. It returns the same layout when nothing changes, so the
 * caller can write the result back without a render loop.
 */
export const reconcileSessionPanelLayout = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
): SessionPanelLayout => {
  const syncedTabs = context.terminalTabsSynced ? context.terminalTabs : null;
  const openKinds = new Set<ToolTabKind>();
  const boundTabIds = new Set<string>();
  const reconcilePanel = (panel: PanelId): PanelTabEntry[] =>
    layout.panels[panel].flatMap((entry): PanelTabEntry[] => {
      if (entry.kind === "new_tab") return [entry];
      if (!canHoldKind(entry.kind, panel, context.ownerKind)) return [];
      if (entry.kind === "terminal") {
        if (syncedTabs === null) return [entry];
        const tab = findEntryTab(entry, syncedTabs);
        if (!tab || boundTabIds.has(tab.tabId)) return [];
        boundTabIds.add(tab.tabId);
        return [bindTerminalEntry(entry, tab)];
      }
      if (openKinds.has(entry.kind)) return [];
      openKinds.add(entry.kind);
      return [entry];
    });
  const panels: PanelEntries = {
    right: reconcilePanel("right"),
    bottom: reconcilePanel("bottom"),
  };

  for (const kind of TOOL_TAB_KINDS) {
    const rule = PANEL_TAB_KIND_RULES[kind];
    if (
      !rule.openByDefault ||
      openKinds.has(kind) ||
      layout.closedKinds.includes(kind) ||
      context.unavailableKinds.has(kind) ||
      !canHoldKind(kind, rule.panels[0], context.ownerKind)
    ) {
      continue;
    }
    const panel = rule.panels[0];
    panels[panel] = [...panels[panel], { id: kind, kind }];
    openKinds.add(kind);
  }
  if (syncedTabs !== null) {
    // A terminal with no position, such as one found again after a reload, opens in the bottom panel.
    const unplaced = syncedTabs.filter((tab) => !boundTabIds.has(tab.tabId));
    if (unplaced.length > 0) panels.bottom = [...panels.bottom, ...unplaced.map(newTerminalEntry)];
  }

  const closedKinds = layout.closedKinds.filter((kind) => !openKinds.has(kind));
  const rightIds = new Set(panels.right.map((entry) => entry.id));
  // A remembered tab that left the panel keeps its key, so the panel selects its first tab, not
  // the default tab of the role.
  const selectedRight: SessionPanelLayout["selectedRight"] = {};
  for (const key of SESSION_PANEL_SELECTION_KEYS) {
    const entryId = layout.selectedRight[key];
    if (entryId === undefined) continue;
    selectedRight[key] = entryId !== null && rightIds.has(entryId) ? entryId : null;
  }
  const selectedBottom = panels.bottom.some((entry) => entry.id === layout.selectedBottom)
    ? layout.selectedBottom
    : null;

  if (
    sameItems(layout.panels.right, panels.right) &&
    sameItems(layout.panels.bottom, panels.bottom) &&
    sameItems(layout.closedKinds, closedKinds) &&
    sameSelection(layout.selectedRight, selectedRight) &&
    layout.selectedBottom === selectedBottom
  ) {
    return layout;
  }
  return { panels, closedKinds, selectedRight, selectedBottom };
};

/** The entries that the panel shows, in order. */
export const shownPanelTabs = (
  layout: SessionPanelLayout,
  panel: PanelId,
  context: SessionPanelContext,
): ResolvedPanelTab[] =>
  layout.panels[panel].flatMap((entry): ResolvedPanelTab[] => {
    if (entry.kind === "new_tab") return [entry];
    if (entry.kind !== "terminal") return context.unavailableKinds.has(entry.kind) ? [] : [entry];
    const terminal = findEntryTab(entry, context.terminalTabs);
    if (!terminal || context.closingTabIds.has(terminal.tabId)) return [];
    return [{ id: entry.id, kind: "terminal", terminal }];
  });

export const selectedPanelTabId = (
  layout: SessionPanelLayout,
  panel: PanelId,
  context: SessionPanelContext,
  tabs: readonly ResolvedPanelTab[] = shownPanelTabs(layout, panel, context),
): string | null => {
  const remembered =
    panel === "right" ? rememberedRightTabId(layout, context.selectionKey) : layout.selectedBottom;
  if (tabs.some((tab) => tab.id === remembered)) return remembered;
  return tabs[0]?.id ?? null;
};

/** The entry and panel of a terminal tab, or null when the layout has no position for it. */
export const findTerminalEntry = (
  layout: SessionPanelLayout,
  tab: Pick<TerminalTab, "tabId" | "terminalId">,
): { panel: PanelId; entry: TerminalTabEntry } | null => {
  for (const panel of PANEL_IDS) {
    for (const entry of layout.panels[panel]) {
      if (entry.kind === "terminal" && isEntryOfTab(entry, tab)) return { panel, entry };
    }
  }
  return null;
};

export const findPanelTab = (
  layout: SessionPanelLayout,
  entryId: string,
): { panel: PanelId; entry: PanelTabEntry } | null => {
  for (const panel of PANEL_IDS) {
    const entry = layout.panels[panel].find((candidate) => candidate.id === entryId);
    if (entry) return { panel, entry };
  }
  return null;
};

/** The one placement check for the launcher, drag and drop, and move actions. */
export const canPlacePanelTab = (
  layout: SessionPanelLayout,
  context: Pick<SessionPanelContext, "ownerKind">,
  kind: PanelTabKind,
  panel: PanelId,
  movingEntryId: string | null = null,
): boolean => {
  if (!canHoldKind(kind, panel, context.ownerKind)) return false;
  if (PANEL_TAB_KIND_RULES[kind].cardinality === "many") return true;
  return !PANEL_IDS.some((id) =>
    layout.panels[id].some((entry) => entry.kind === kind && entry.id !== movingEntryId),
  );
};

/** Tells if a tab can go to a panel: a reorder in its own panel, or a move that its kind allows. */
export const canMovePanelTab = (
  layout: SessionPanelLayout,
  context: Pick<SessionPanelContext, "ownerKind">,
  entryId: string,
  to: PanelId,
): boolean => {
  const found = findPanelTab(layout, entryId);
  if (!found) return false;
  if (found.panel === to) return true;
  return (
    found.entry.kind !== "new_tab" &&
    canPlacePanelTab(layout, context, found.entry.kind, to, entryId)
  );
};

const neighborTabId = (tabs: readonly ResolvedPanelTab[], entryId: string): string | null => {
  const index = tabs.findIndex((tab) => tab.id === entryId);
  if (index < 0) return null;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
};

const withSelection = (
  layout: SessionPanelLayout,
  panel: PanelId,
  selectionKey: SessionPanelSelectionKey,
  entryId: string | null,
): SessionPanelLayout => {
  if (panel === "bottom") {
    return layout.selectedBottom === entryId ? layout : { ...layout, selectedBottom: entryId };
  }
  if (layout.selectedRight[selectionKey] === entryId) return layout;
  return { ...layout, selectedRight: { ...layout.selectedRight, [selectionKey]: entryId } };
};

const withPanelEntries = (
  layout: SessionPanelLayout,
  panel: PanelId,
  entries: PanelTabEntry[],
): SessionPanelLayout => ({ ...layout, panels: { ...layout.panels, [panel]: entries } });

const insertAt = <Value>(items: readonly Value[], index: number, item: Value): Value[] => [
  ...items.slice(0, index),
  item,
  ...items.slice(index),
];

export const selectPanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  entryId: string,
): SessionPanelLayout =>
  layout.panels[panel].some((entry) => entry.id === entryId)
    ? withSelection(layout, panel, context.selectionKey, entryId)
    : layout;

/** Selects the neighbor of a selected tab that is about to leave the panel. */
export const selectPanelTabNeighbor = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  entryId: string,
): SessionPanelLayout => {
  const tabs = shownPanelTabs(layout, panel, context);
  if (selectedPanelTabId(layout, panel, context, tabs) !== entryId) return layout;
  return withSelection(layout, panel, context.selectionKey, neighborTabId(tabs, entryId));
};

/** Adds the New tab at the end of the panel, or selects the New tab that the panel has. */
export const addNewPanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
): SessionPanelLayout => {
  const existing = layout.panels[panel].find((entry) => entry.kind === "new_tab");
  if (existing) return withSelection(layout, panel, context.selectionKey, existing.id);
  const entry: NewTabEntry = { id: newTabEntryId(panel), kind: "new_tab" };
  return withSelection(
    withPanelEntries(layout, panel, [...layout.panels[panel], entry]),
    panel,
    context.selectionKey,
    entry.id,
  );
};

export type PanelTabChoice = { kind: ToolTabKind } | { kind: "terminal"; tabId: string };

/** Opens the picked kind in place of the panel New tab, or at the end when the panel has none. */
export const pickPanelTabKind = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  choice: PanelTabChoice,
): SessionPanelLayout => {
  const entries = layout.panels[panel];
  const newTabIndex = entries.findIndex((entry) => entry.kind === "new_tab");
  const withoutNewTab = entries.filter((_entry, index) => index !== newTabIndex);
  if (choice.kind !== "terminal") {
    const open = findPanelTab(layout, choice.kind);
    if (open) {
      const next = withPanelEntries(layout, panel, withoutNewTab);
      return withSelection(next, open.panel, context.selectionKey, open.entry.id);
    }
  }
  if (!canPlacePanelTab(layout, context, choice.kind, panel)) return layout;
  const entry: PanelTabEntry =
    choice.kind === "terminal"
      ? newTerminalEntry({ tabId: choice.tabId, terminalId: null })
      : { id: choice.kind, kind: choice.kind };
  const index = newTabIndex < 0 ? withoutNewTab.length : newTabIndex;
  const next = withPanelEntries(layout, panel, insertAt(withoutNewTab, index, entry));
  return withSelection(
    { ...next, closedKinds: next.closedKinds.filter((kind) => kind !== choice.kind) },
    panel,
    context.selectionKey,
    entry.id,
  );
};

/** Puts a new terminal at the end of a panel and selects it. */
export const appendTerminalPanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  tabId: string,
): SessionPanelLayout => {
  if (!canPlacePanelTab(layout, context, "terminal", panel)) return layout;
  const entry = newTerminalEntry({ tabId, terminalId: null });
  return withSelection(
    withPanelEntries(layout, panel, [...layout.panels[panel], entry]),
    panel,
    context.selectionKey,
    entry.id,
  );
};

/** Removes a tool tab or the New tab. A terminal tab leaves the layout when its terminal closes. */
export const closePanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  entryId: string,
): SessionPanelLayout => {
  const entry = layout.panels[panel].find((candidate) => candidate.id === entryId);
  if (!entry || entry.kind === "terminal") return layout;
  const selected = selectPanelTabNeighbor(layout, context, panel, entryId);
  const next = withPanelEntries(
    selected,
    panel,
    selected.panels[panel].filter((candidate) => candidate.id !== entryId),
  );
  if (entry.kind === "new_tab" || !PANEL_TAB_KIND_RULES[entry.kind].openByDefault) return next;
  return { ...next, closedKinds: [...next.closedKinds, entry.kind] };
};

/** Reorders a tab in its panel, or moves it to the other panel when its kind allows that panel. */
export const movePanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  entryId: string,
  to: PanelId,
  target: PanelDropTarget,
): SessionPanelLayout => {
  const found = findPanelTab(layout, entryId);
  if (!found || target?.id === entryId || !canMovePanelTab(layout, context, entryId, to)) {
    return layout;
  }
  const { panel: from, entry } = found;
  const source = from === to ? layout : selectPanelTabNeighbor(layout, context, from, entryId);
  const remaining = withPanelEntries(
    source,
    from,
    source.panels[from].filter((candidate) => candidate.id !== entryId),
  );
  const targetEntries = remaining.panels[to];
  const targetIndex = target
    ? targetEntries.findIndex((candidate) => candidate.id === target.id)
    : -1;
  let index = targetEntries.length;
  if (targetIndex >= 0) index = target?.position === "after" ? targetIndex + 1 : targetIndex;
  const next = withPanelEntries(remaining, to, insertAt(targetEntries, index, entry));
  return from === to ? next : withSelection(next, to, context.selectionKey, entryId);
};
