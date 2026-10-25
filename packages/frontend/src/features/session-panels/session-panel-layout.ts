import {
  BUILTIN_ROLE_IDS,
  BUILTIN_DEFAULT_RIGHT_PANEL_BY_ROLE,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import { type BrowserTabSummary } from "@openducktor/contracts";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import {
  HOST_TAB_KINDS,
  type HostTabKind,
  isHostTabKind,
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
  ...BUILTIN_ROLE_IDS,
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
/** The place of a browser tab. The host saves the tab itself, with its URL and sharing state. */
export type BrowserTabEntry = { id: string; kind: "browser"; tabId: string };
type NewTabEntry = { id: string; kind: "new_tab" };
export type PanelTabEntry = ToolTabEntry | TerminalTabEntry | BrowserTabEntry | NewTabEntry;

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

/** The entry and host tab types of each host-tab kind. */
type HostTabTypes = {
  terminal: { entry: TerminalTabEntry; tab: TerminalTab };
  browser: { entry: BrowserTabEntry; tab: BrowserTabSummary };
};

type HostTabEntry<Kind extends HostTabKind> = HostTabTypes[Kind]["entry"];
type HostTab<Kind extends HostTabKind> = HostTabTypes[Kind]["tab"];

/** A browser tab entry and its host tab. The host tab is null until the host lists the tab. */
export type ResolvedBrowserTab = {
  id: string;
  kind: "browser";
  entry: BrowserTabEntry;
  tab: BrowserTabSummary | null;
};

type ResolvedHostTabs = {
  terminal: { id: string; kind: "terminal"; terminal: TerminalTab };
  browser: ResolvedBrowserTab;
};

/** A shown tab of a host-tab kind. */
export type ResolvedHostTab<Kind extends HostTabKind = HostTabKind> = ResolvedHostTabs[Kind];

export type ResolvedPanelTab =
  | { id: string; kind: ToolTabKind }
  | ResolvedHostTab
  | { id: string; kind: "new_tab" };

export const isResolvedHostTab = (tab: ResolvedPanelTab): tab is ResolvedHostTab =>
  isHostTabKind(tab.kind);

/** The host tabs of the owner for one host-tab kind. */
export type HostTabSource<Tab> = {
  /** All host tabs of the owner, also the tabs that close now. */
  tabs: readonly Tab[];
  /** True when `tabs` is the latest host list, so an entry without a host tab is gone. */
  synced: boolean;
  /** Tabs that the user closes now. They hide, and they leave when the host closes them. */
  closingIds: ReadonlySet<string>;
  /** New tabs that this client asked to open. Their entries stay until the host list has them. */
  openingIds: ReadonlySet<string>;
};

/** The live facts that decide which entries a layout keeps and shows. */
export type SessionPanelContext = {
  ownerKind: SessionOwnerKind;
  selectionKey: SessionPanelSelectionKey;
  /** Kinds that the rules allow but that the page cannot show now, such as CI Checks without a pull request. */
  unavailableKinds: ReadonlySet<PanelTabKind>;
  hostTabs: { [Kind in HostTabKind]: HostTabSource<HostTab<Kind>> };
};

/** What the panels do with the tabs of one host-tab kind. */
export type HostTabActions<Kind extends HostTabKind> = {
  /** Opens a new tab in place of the New tab of the panel. */
  pick: (panel: PanelId) => void;
  /** Closes the host tab. Its entry leaves when the host closes it. */
  close: (panel: PanelId, tab: ResolvedHostTab<Kind>) => void;
};

export type HostTabActionMap = { [Kind in HostTabKind]: HostTabActions<Kind> };

export type PanelDropTarget = { id: string; position: "before" | "after" } | null;

/** Changes the stored layout of the current owner. The change gets the reconciled layout. */
export type SessionPanelLayoutUpdate = (
  mutate: (layout: SessionPanelLayout, context: SessionPanelContext) => SessionPanelLayout,
) => void;

const PANEL_IDS: readonly PanelId[] = ["right", "bottom"];

const DEFAULT_RIGHT_SELECTION = {
  ...BUILTIN_DEFAULT_RIGHT_PANEL_BY_ROLE,
  chat: "diffs",
} satisfies Record<SessionPanelSelectionKey, ToolTabKind>;

const SELECTION_KEYS_BY_OWNER_KIND = {
  task: BUILTIN_ROLE_IDS,
  chat: ["chat"],
} as const satisfies Record<SessionOwnerKind, readonly SessionPanelSelectionKey[]>;

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

export const browserEntryId = (tabId: string): string => `browser:${tabId}`;

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

/** The entry of a new browser tab. */
export const browserTabEntry = (tabId: string): BrowserTabEntry => ({
  id: browserEntryId(tabId),
  kind: "browser",
  tabId,
});

/** How the entries of one host-tab kind match their host tabs. */
type HostTabRules<Kind extends HostTabKind> = {
  /** The panel of a host tab that has no entry. */
  defaultPanel: PanelId;
  newEntry: (tabId: string) => HostTabEntry<Kind>;
  findTab: (entry: HostTabEntry<Kind>, tabs: readonly HostTab<Kind>[]) => HostTab<Kind> | undefined;
  /** The entry with the latest IDs of its host tab. */
  bindEntry: (entry: HostTabEntry<Kind>, tab: HostTab<Kind>) => HostTabEntry<Kind>;
};

type HostTabRuleMap = { [Kind in HostTabKind]: HostTabRules<Kind> };

const HOST_TAB_RULES: HostTabRuleMap = {
  terminal: {
    // A terminal with no position, such as one found again after a reload, opens in the bottom panel.
    defaultPanel: "bottom",
    newEntry: (tabId) => ({
      id: terminalEntryId(tabId),
      kind: "terminal",
      tabId,
      terminalId: null,
    }),
    // A terminal keeps its entry when the host gives its tab a new ID.
    findTab: (entry, tabs) =>
      tabs.find((tab) => tab.tabId === entry.tabId) ??
      (entry.terminalId === null
        ? undefined
        : tabs.find((tab) => tab.terminalId === entry.terminalId)),
    bindEntry: (entry, tab) => {
      const terminalId = tab.terminalId ?? entry.terminalId;
      if (entry.tabId === tab.tabId && entry.terminalId === terminalId) return entry;
      return { ...entry, tabId: tab.tabId, terminalId };
    },
  },
  browser: {
    // The browser feature places new popups and agent tabs before a page shows them. Any other
    // host tab without an entry goes to the end of the right panel.
    defaultPanel: "right",
    newEntry: browserTabEntry,
    findTab: (entry, tabs) => tabs.find((tab) => tab.tabId === entry.tabId),
    bindEntry: (entry) => entry,
  },
};

/**
 * Keeps an entry while its host tab exists, or while its tab opens. Before the host list is
 * synced, saved entries stay as they are.
 */
const reconcileHostEntry = <Kind extends HostTabKind>(
  kind: Kind,
  entry: HostTabEntry<Kind>,
  context: SessionPanelContext,
  placedTabIds: Set<string>,
): PanelTabEntry[] => {
  const rules = HOST_TAB_RULES[kind];
  const source = context.hostTabs[kind];
  const tab = source.synced ? rules.findTab(entry, source.tabs) : undefined;
  if (source.synced && !tab && !source.openingIds.has(entry.tabId)) return [];
  const bound = tab ? rules.bindEntry(entry, tab) : entry;
  if (placedTabIds.has(bound.tabId)) return [];
  placedTabIds.add(bound.tabId);
  return [bound];
};

/** Adds an entry for each synced host tab that has none, at the end of the default panel. */
const withUnplacedHostTabs = <Kind extends HostTabKind>(
  panels: PanelEntries,
  kind: Kind,
  context: SessionPanelContext,
  placedTabIds: ReadonlySet<string>,
): PanelEntries => {
  const rules = HOST_TAB_RULES[kind];
  const source = context.hostTabs[kind];
  if (!source.synced) return panels;
  const unplaced = source.tabs.filter(
    (tab) => !placedTabIds.has(tab.tabId) && !source.closingIds.has(tab.tabId),
  );
  if (unplaced.length === 0) return panels;
  const panel = rules.defaultPanel;
  const added = unplaced.map((tab) => rules.bindEntry(rules.newEntry(tab.tabId), tab));
  return { ...panels, [panel]: [...panels[panel], ...added] };
};

const sameItems = <Value>(left: readonly Value[], right: readonly Value[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameSelection = (
  left: SessionPanelLayout["selectedRight"],
  right: SessionPanelLayout["selectedRight"],
): boolean => SESSION_PANEL_SELECTION_KEYS.every((key) => left[key] === right[key]);

const insertAt = <Value>(items: readonly Value[], index: number, item: Value): Value[] => [
  ...items.slice(0, index),
  item,
  ...items.slice(index),
];

/** Adds the default-open tool tabs that the layout does not have and that the user did not close. */
const withDefaultToolTabs = (
  panels: PanelEntries,
  openKinds: Set<ToolTabKind>,
  closedKinds: readonly ToolTabKind[],
  ownerKind: SessionOwnerKind,
  unavailableKinds: ReadonlySet<PanelTabKind>,
): PanelEntries => {
  let next = panels;
  for (const kind of TOOL_TAB_KINDS) {
    const rule = PANEL_TAB_KIND_RULES[kind];
    const panel = rule.panels[0];
    if (
      !rule.openByDefault ||
      openKinds.has(kind) ||
      closedKinds.includes(kind) ||
      unavailableKinds.has(kind) ||
      !canHoldKind(kind, panel, ownerKind)
    ) {
      continue;
    }
    next = { ...next, [panel]: [...next[panel], { id: kind, kind }] };
    openKinds.add(kind);
  }
  return next;
};

/**
 * Applies the current rules to a layout. It returns the same layout when nothing changes, so the
 * caller can write the result back without a render loop.
 */
export const reconcileSessionPanelLayout = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
): SessionPanelLayout => {
  const openKinds = new Set<ToolTabKind>();
  const placedTabIds = { terminal: new Set<string>(), browser: new Set<string>() };
  const reconcilePanel = (panel: PanelId): PanelTabEntry[] =>
    layout.panels[panel].flatMap((entry): PanelTabEntry[] => {
      if (entry.kind === "new_tab") return [entry];
      if (!canHoldKind(entry.kind, panel, context.ownerKind)) return [];
      if (entry.kind === "terminal") {
        return reconcileHostEntry("terminal", entry, context, placedTabIds.terminal);
      }
      if (entry.kind === "browser") {
        return reconcileHostEntry("browser", entry, context, placedTabIds.browser);
      }
      if (openKinds.has(entry.kind)) return [];
      openKinds.add(entry.kind);
      return [entry];
    });
  let panels: PanelEntries = withDefaultToolTabs(
    { right: reconcilePanel("right"), bottom: reconcilePanel("bottom") },
    openKinds,
    layout.closedKinds,
    context.ownerKind,
    context.unavailableKinds,
  );
  for (const kind of HOST_TAB_KINDS) {
    panels = withUnplacedHostTabs(panels, kind, context, placedTabIds[kind]);
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
    if (entry.kind === "terminal") {
      const { tabs, closingIds } = context.hostTabs.terminal;
      const terminal = HOST_TAB_RULES.terminal.findTab(entry, tabs);
      if (!terminal || closingIds.has(terminal.tabId)) return [];
      return [{ id: entry.id, kind: "terminal", terminal }];
    }
    if (context.unavailableKinds.has(entry.kind)) return [];
    if (entry.kind === "browser") {
      // A new tab shows before the host lists it.
      const { tabs, closingIds } = context.hostTabs.browser;
      if (closingIds.has(entry.tabId)) return [];
      const tab = HOST_TAB_RULES.browser.findTab(entry, tabs) ?? null;
      return [{ id: entry.id, kind: "browser", entry, tab }];
    }
    return [entry];
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
): { panel: PanelId; index: number; entry: PanelTabEntry } | null => {
  for (const panel of PANEL_IDS) {
    const index = layout.panels[panel].findIndex((candidate) => candidate.id === entryId);
    const entry = layout.panels[panel][index];
    if (entry) return { panel, index, entry };
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

/** A tool kind, or a new host tab. The caller gives a new host tab its tab ID. */
export type PanelTabChoice = { kind: ToolTabKind } | { kind: HostTabKind; tabId: string };

const choiceEntry = (choice: PanelTabChoice): PanelTabEntry =>
  "tabId" in choice
    ? HOST_TAB_RULES[choice.kind].newEntry(choice.tabId)
    : { id: choice.kind, kind: choice.kind };

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
  if (PANEL_TAB_KIND_RULES[choice.kind].cardinality === "unique") {
    const open = findPanelTab(layout, choice.kind);
    if (open) {
      const next = withPanelEntries(layout, panel, withoutNewTab);
      return withSelection(next, open.panel, context.selectionKey, open.entry.id);
    }
  }
  if (!canPlacePanelTab(layout, context, choice.kind, panel)) return layout;
  const entry = choiceEntry(choice);
  const index = newTabIndex < 0 ? withoutNewTab.length : newTabIndex;
  const next = withPanelEntries(layout, panel, insertAt(withoutNewTab, index, entry));
  return withSelection(
    { ...next, closedKinds: next.closedKinds.filter((kind) => kind !== choice.kind) },
    panel,
    context.selectionKey,
    entry.id,
  );
};

/** Puts a new host tab at the end of a panel and selects it. */
export const appendPanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  choice: Extract<PanelTabChoice, { tabId: string }>,
): SessionPanelLayout => {
  if (!canPlacePanelTab(layout, context, choice.kind, panel)) return layout;
  const entry = choiceEntry(choice);
  return withSelection(
    withPanelEntries(layout, panel, [...layout.panels[panel], entry]),
    panel,
    context.selectionKey,
    entry.id,
  );
};

/**
 * Removes an entry, such as the entry of a host tab that closed. A selection of the entry becomes a
 * selection whose tab is gone, so its panel selects its first tab.
 */
export const removePanelEntry = (
  layout: SessionPanelLayout,
  entryId: string,
): SessionPanelLayout => {
  const found = findPanelTab(layout, entryId);
  if (!found) return layout;
  const selectedRight = { ...layout.selectedRight };
  for (const key of SESSION_PANEL_SELECTION_KEYS) {
    if (selectedRight[key] === entryId) selectedRight[key] = null;
  }
  const entries = layout.panels[found.panel].filter((entry) => entry.id !== entryId);
  return {
    ...withPanelEntries(layout, found.panel, entries),
    selectedRight,
    selectedBottom: layout.selectedBottom === entryId ? null : layout.selectedBottom,
  };
};

/**
 * Puts a new entry right after an anchor entry, in the panel of the anchor. With `takeSelection`,
 * the new entry takes each remembered selection of the anchor. A layout without the anchor does
 * not change.
 */
export const insertPanelEntryAfter = (
  layout: SessionPanelLayout,
  anchorId: string,
  entry: PanelTabEntry,
  { takeSelection }: { takeSelection: boolean },
): SessionPanelLayout => {
  const anchor = findPanelTab(layout, anchorId);
  if (!anchor) return layout;
  const entries = insertAt(layout.panels[anchor.panel], anchor.index + 1, entry);
  const placed = withPanelEntries(layout, anchor.panel, entries);
  if (!takeSelection) return placed;
  if (anchor.panel === "bottom") {
    return layout.selectedBottom === anchorId ? { ...placed, selectedBottom: entry.id } : placed;
  }
  const selectedRight = { ...layout.selectedRight };
  for (const key of SESSION_PANEL_SELECTION_KEYS) {
    if (selectedRight[key] === anchorId) selectedRight[key] = entry.id;
  }
  return { ...placed, selectedRight };
};

/**
 * Puts a new entry at the end of the right panel of an owner whose page may not show, and selects
 * it there for each selection key of the owner. A layout that never showed gets its default tool
 * tabs first, so the entry is the last tab.
 */
export const appendRightPanelEntry = (
  layout: SessionPanelLayout,
  ownerKind: SessionOwnerKind,
  entry: PanelTabEntry,
): SessionPanelLayout => {
  const isNew =
    layout.panels.right.length === 0 &&
    layout.panels.bottom.length === 0 &&
    layout.closedKinds.length === 0;
  const panels = isNew
    ? withDefaultToolTabs(layout.panels, new Set(), [], ownerKind, new Set())
    : layout.panels;
  const selectedRight = { ...layout.selectedRight };
  for (const key of SELECTION_KEYS_BY_OWNER_KIND[ownerKind]) selectedRight[key] = entry.id;
  return { ...layout, panels: { ...panels, right: [...panels.right, entry] }, selectedRight };
};

/** Removes a tool tab or the New tab. A host tab leaves the layout when the host closes it. */
export const closePanelTab = (
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  panel: PanelId,
  entryId: string,
): SessionPanelLayout => {
  const entry = layout.panels[panel].find((candidate) => candidate.id === entryId);
  if (!entry || isHostTabKind(entry.kind)) return layout;
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
