import type { BrowserTabSummary, RepoAction } from "@openducktor/contracts";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import {
  isTerminalToggleShortcut,
  type MountedTerminal,
  type TerminalCloseDialogModel,
} from "@/features/terminals";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import {
  type HostTabKind,
  isHostTabKind,
  PANEL_TAB_KINDS,
  type PanelId,
  type PanelTabKind,
  type ToolTabKind,
} from "./panel-tab-kinds";
import {
  addNewPanelTab,
  appendPanelTab,
  canMovePanelTab,
  canPlacePanelTab,
  closePanelTab,
  emptySessionPanelLayout,
  findPanelTab,
  findTerminalEntry,
  type HostTabActionMap,
  isResolvedHostTab,
  movePanelTab,
  type PanelDropTarget,
  pickPanelTabKind,
  reconcileSessionPanelLayout,
  type ResolvedHostTab,
  type ResolvedPanelTab,
  type SessionPanelContext,
  type SessionPanelLayout,
  type SessionPanelLayoutUpdate,
  type SessionPanelOwner,
  type SessionPanelSelectionKey,
  selectedPanelTabId,
  selectPanelTab,
  sessionPanelOwnerKey,
  shownPanelTabs,
} from "./session-panel-layout";
import { useSessionPanelLayoutStore } from "./session-panel-layout-store";
import {
  type BrowserAddressFocus,
  type BrowserTabView,
  type LatestBrowserState,
  type SessionPanelBrowserModel,
  useSessionPanelBrowserTabs,
} from "./use-session-panel-browser-tabs";
import {
  type LatestPanelState,
  useSessionPanelTerminalTabs,
} from "./use-session-panel-terminal-tabs";
import {
  type PanelMotion,
  type PanelPresence,
  useSessionPanelVisibility,
} from "./use-session-panel-visibility";

export type {
  BrowserAddressFocus,
  SessionPanelBrowserModel,
} from "./use-session-panel-browser-tabs";
export type { PanelPresence } from "./use-session-panel-visibility";

export type PanelLauncherEntry = { kind: PanelTabKind; disabledReason: string | null };

export type SessionPanelModel = {
  panel: PanelId;
  /** How the panel shows. The page calls `onSettled` when an opening or closing slide ends. */
  presence: PanelPresence;
  onSettled: () => void;
  /** Hides the panel after the user made it zero in size with its separator. */
  onCollapsed: () => void;
  /** True while the panel shows, also while it slides in or out. */
  isVisible: boolean;
  /** The kind of the selected tab while the panel shows, or null. */
  activeKind: ResolvedPanelTab["kind"] | null;
  /** Shown tabs in order. Terminal tabs carry their terminal tab. */
  tabs: ResolvedPanelTab[];
  selectedTabId: string | null;
  launcher: PanelLauncherEntry[];
  focusRequest: number;
  /** The last browser tab that the user opened from a launcher. Its address bar takes focus. */
  browserAddressFocus: BrowserAddressFocus | null;
  /** Renders browser tabs, or null when the page has no browser model. */
  browserTabView: BrowserTabView | null;
  terminals: TerminalSessionsModel;
  terminalMounts: MountedTerminal[];
  /** The mount key of the selected terminal, or null when another tab is selected. */
  activeTerminalKey: string | null;
  onSelect: (entryId: string) => void;
  onClose: (entryId: string) => void;
  onAddTab: () => void;
  onPick: (kind: PanelTabKind) => void;
  /** Hides the panel. Only the bottom panel has it, for the narrow layout. */
  onHide: (() => void) | null;
  /** The base of the IDs that link each tab to its content. A terminal content is in a portal. */
  tabIdBase: string;
};

export type SessionPanelsModel = {
  right: SessionPanelModel;
  bottom: SessionPanelModel;
  rightToggle: { isOpen: boolean; onToggle: () => void } | null;
  bottomToggle: { isAvailable: boolean; isOpen: boolean; onToggle: () => void };
  /** Runs a repository action in a new terminal tab at the end of the bottom panel. */
  runAction: (action: RepoAction) => void;
  startBlockedReason: string | null;
  /** Tells if a tab can go to a panel, by a reorder in its panel or a move to the other panel. */
  canMove: (entryId: string, to: PanelId) => boolean;
  /** Moves a tab to the end of a panel when its kind allows that panel. */
  onMove: (entryId: string, to: PanelId) => void;
  onDrop: (entryId: string, to: PanelId, target: PanelDropTarget) => void;
  terminalClose: TerminalCloseDialogModel;
  platformError: string | null;
};

type SessionPanelsInput = {
  owner: SessionPanelOwner | null;
  selectionKey: SessionPanelSelectionKey;
  /** Kinds that the rules allow but that the page cannot show now. */
  unavailableKinds?: ReadonlySet<ToolTabKind>;
  terminals: TerminalSessionsModel;
  shortcutsEnabled?: boolean;
  /** The browser tabs of the owner. Without it, the panels offer no browser tabs and hide saved ones. */
  browser?: SessionPanelBrowserModel | null;
};

type LatestControllerState = LatestPanelState &
  LatestBrowserState & {
    owner: SessionPanelOwner | null;
    isBottomOpen: boolean;
  };

const EMPTY_LAYOUT = emptySessionPanelLayout();
const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = [];
const EMPTY_BROWSER_TABS: readonly BrowserTabSummary[] = [];
const EMPTY_TAB_IDS: ReadonlySet<string> = new Set();
const NO_UNAVAILABLE_KINDS: ReadonlySet<ToolTabKind> = new Set();
const EMPTY_LAYOUT_SNAPSHOT = (): SessionPanelLayout => EMPTY_LAYOUT;

/** Why the launcher cannot open a tab of each host-tab kind now, or null when it can. */
type LauncherBlockedReasons = Record<HostTabKind, string | null>;

/** The kinds that a panel can open now. An open unique kind has no entry, because its tab shows. */
const launcherFor = (
  panel: PanelId,
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  blockedReasons: LauncherBlockedReasons,
): PanelLauncherEntry[] =>
  PANEL_TAB_KINDS.flatMap((kind): PanelLauncherEntry[] => {
    if (context.unavailableKinds.has(kind)) return [];
    if (!canPlacePanelTab(layout, context, kind, panel)) return [];
    return [{ kind, disabledReason: isHostTabKind(kind) ? blockedReasons[kind] : null }];
  });

/** Closes a host tab with the actions of its kind. */
const closeHostTab = <Kind extends HostTabKind>(
  actions: HostTabActionMap,
  kind: Kind,
  panel: PanelId,
  tab: ResolvedHostTab<Kind>,
): void => actions[kind].close(panel, tab);

const mountKey = (scopeKey: string, tabId: string): string => `${scopeKey}:${tabId}`;

type PanelTerminalMounts = { right: MountedTerminal[]; bottom: MountedTerminal[] };

/**
 * Places the mounted terminals of all scopes in the panel that holds them, so a switch between
 * owners does not mount a viewport again. Only the terminals of the selected owner show.
 */
const placeMountedTerminals = (
  mountedTabs: TerminalSessionsModel["mountedTabs"],
  ownerKey: string | null,
  layout: SessionPanelLayout,
  otherLayouts: ReadonlyMap<string, SessionPanelLayout>,
): PanelTerminalMounts => {
  const mounts: PanelTerminalMounts = { right: [], bottom: [] };
  for (const mounted of mountedTabs) {
    const isOwner = mounted.scopeKey === ownerKey;
    const placement = isOwner ? layout : (otherLayouts.get(mounted.scopeKey) ?? null);
    const found = placement ? findTerminalEntry(placement, mounted.tab) : null;
    mounts[found?.panel ?? "bottom"].push({
      key: mountKey(mounted.scopeKey, mounted.tab.tabId),
      scopeKey: mounted.scopeKey,
      tab: mounted.tab,
      value: isOwner && found ? found.entry.id : null,
    });
  }
  return mounts;
};

type PanelActions = {
  selectTab: (panel: PanelId, entryId: string) => void;
  closeTab: (panel: PanelId, entryId: string) => void;
  addTab: (panel: PanelId) => void;
  pickKind: (panel: PanelId, kind: PanelTabKind) => void;
  hideBottom: () => void;
};

const usePanelModel = (
  panel: PanelId,
  state: {
    presence: PanelPresence;
    onSettled: () => void;
    onCollapsed: () => void;
    layout: SessionPanelLayout;
    tabs: ResolvedPanelTab[];
    selectedTabId: string | null;
    context: SessionPanelContext;
    ownerKey: string | null;
    focusRequest: number;
    browserAddressFocus: BrowserAddressFocus | null;
    blockedReasons: LauncherBlockedReasons;
    browserTabView: BrowserTabView | null;
    terminals: TerminalSessionsModel;
    terminalMounts: MountedTerminal[];
  },
  actions: PanelActions,
): SessionPanelModel => {
  const { presence, onSettled, onCollapsed, layout, tabs, selectedTabId, context, ownerKey } =
    state;
  const { focusRequest, browserAddressFocus, blockedReasons } = state;
  const { browserTabView } = state;
  const { terminals, terminalMounts } = state;
  const { selectTab, closeTab, addTab, pickKind, hideBottom } = actions;
  const tabIdBase = useId();
  return useMemo(() => {
    const isVisible = presence !== "closed";
    const selectedTab = tabs.find((tab) => tab.id === selectedTabId);
    return {
      panel,
      presence,
      onSettled,
      onCollapsed,
      isVisible,
      activeKind: isVisible ? (selectedTab?.kind ?? null) : null,
      tabs,
      selectedTabId,
      launcher: launcherFor(panel, layout, context, blockedReasons),
      focusRequest,
      browserAddressFocus,
      browserTabView,
      terminals,
      terminalMounts,
      activeTerminalKey:
        selectedTab?.kind === "terminal" && ownerKey !== null
          ? mountKey(ownerKey, selectedTab.terminal.tabId)
          : null,
      onSelect: (entryId) => selectTab(panel, entryId),
      onClose: (entryId) => closeTab(panel, entryId),
      onAddTab: () => addTab(panel),
      onPick: (kind) => pickKind(panel, kind),
      onHide: panel === "bottom" ? hideBottom : null,
      tabIdBase,
    };
  }, [
    addTab,
    blockedReasons,
    browserAddressFocus,
    browserTabView,
    closeTab,
    context,
    focusRequest,
    hideBottom,
    layout,
    onCollapsed,
    onSettled,
    ownerKey,
    panel,
    pickKind,
    presence,
    selectTab,
    selectedTabId,
    tabIdBase,
    tabs,
    terminalMounts,
    terminals,
  ]);
};

/** Reads the layout of the owner from the store, and saves reconcile results and read errors. */
const useOwnerLayout = (owner: SessionPanelOwner | null, context: SessionPanelContext) => {
  const layoutStore = useSessionPanelLayoutStore();
  const ownerKey = owner ? sessionPanelOwnerKey(owner) : null;
  const readOwnerLayout = useMemo(
    () => (owner ? () => layoutStore.read(owner) : EMPTY_LAYOUT_SNAPSHOT),
    [layoutStore, owner],
  );
  const storedLayout = useSyncExternalStore(layoutStore.subscribe, readOwnerLayout);
  const layouts = useSyncExternalStore(layoutStore.subscribe, layoutStore.snapshot);
  const layout = useMemo(
    () => (owner ? reconcileSessionPanelLayout(storedLayout, context) : EMPTY_LAYOUT),
    [context, owner, storedLayout],
  );

  // Write reconcile results back, so a later page mount keeps the terminal positions. A store change
  // after this render, such as a new terminal tab, wins, and the next render reconciles it.
  useEffect(() => {
    if (!owner || layout === storedLayout) return;
    layoutStore.update(owner, (current) => (current === storedLayout ? layout : current));
  }, [layout, layoutStore, owner, storedLayout]);

  const ownerRef = useRef(owner);
  useLayoutEffect(() => {
    ownerRef.current = owner;
  });
  useEffect(() => {
    const current = ownerRef.current;
    if (!current || ownerKey === null) return;
    const error = layoutStore.takeReadError(current);
    if (error) {
      toast.error("Could not restore the saved panel layout", {
        description: `${error} The default layout is shown.`,
      });
    }
  }, [layoutStore, ownerKey]);

  return { layout, layouts };
};

/**
 * Owns the tab layout of the right and bottom panels for one task or chat. The page shell calls it
 * and gives each panel its content.
 */
export function useSessionPanels({
  owner,
  selectionKey,
  unavailableKinds = NO_UNAVAILABLE_KINDS,
  terminals,
  shortcutsEnabled = true,
  browser = null,
}: SessionPanelsInput): SessionPanelsModel {
  const isActive = useSessionViewActive();
  const layoutStore = useSessionPanelLayoutStore();
  const ownerKey = owner ? sessionPanelOwnerKey(owner) : null;
  const isOwnerTerminals = ownerKey !== null && terminals.scopeKey === ownerKey;
  const hasBrowser = browser !== null;
  const ownerBrowser = browser !== null && browser.scopeKey === ownerKey ? browser : null;
  const allUnavailableKinds = useMemo<ReadonlySet<PanelTabKind>>(
    () => (hasBrowser ? unavailableKinds : new Set([...unavailableKinds, "browser"])),
    [hasBrowser, unavailableKinds],
  );
  const context = useMemo<SessionPanelContext>(
    () => ({
      ownerKind: owner?.kind ?? "task",
      selectionKey,
      unavailableKinds: allUnavailableKinds,
      hostTabs: {
        terminal: {
          tabs: isOwnerTerminals ? terminals.tabs : EMPTY_TERMINAL_TABS,
          synced: isOwnerTerminals && terminals.isSynced,
          closingIds: isOwnerTerminals ? terminals.closingTabIds : EMPTY_TAB_IDS,
          openingIds: EMPTY_TAB_IDS,
        },
        browser: {
          tabs: ownerBrowser?.tabs ?? EMPTY_BROWSER_TABS,
          synced: ownerBrowser?.isSynced ?? false,
          closingIds: ownerBrowser?.closingTabIds ?? EMPTY_TAB_IDS,
          openingIds: ownerBrowser?.openingTabIds ?? EMPTY_TAB_IDS,
        },
      },
    }),
    [
      isOwnerTerminals,
      owner?.kind,
      ownerBrowser?.closingTabIds,
      ownerBrowser?.isSynced,
      ownerBrowser?.openingTabIds,
      ownerBrowser?.tabs,
      selectionKey,
      allUnavailableKinds,
      terminals.closingTabIds,
      terminals.isSynced,
      terminals.tabs,
    ],
  );
  const { layout, layouts } = useOwnerLayout(owner, context);
  const rightTabs = useMemo(() => shownPanelTabs(layout, "right", context), [context, layout]);
  const bottomTabs = useMemo(() => shownPanelTabs(layout, "bottom", context), [context, layout]);
  const visibility = useSessionPanelVisibility(ownerKey, bottomTabs, isActive);
  const { isRightOpen, isBottomOpen, setBottomOpen, toggleRight, showRight, requestFocus } =
    visibility;
  const rightSelected = selectedPanelTabId(layout, "right", context, rightTabs);
  const bottomSelected = selectedPanelTabId(layout, "bottom", context, bottomTabs);

  const latestState: LatestControllerState = {
    owner,
    ownerKey,
    context,
    layout,
    terminals,
    browser: ownerBrowser,
    isRightOpen,
    isBottomOpen,
    tabs: { right: rightTabs, bottom: bottomTabs },
    selected: { right: rightSelected, bottom: bottomSelected },
  };
  const latest = useRef(latestState);
  useLayoutEffect(() => {
    latest.current = latestState;
  });

  const update = useCallback<SessionPanelLayoutUpdate>(
    (mutate) => {
      const { owner: currentOwner, context: currentContext } = latest.current;
      if (!currentOwner) return;
      layoutStore.update(currentOwner, (current) =>
        mutate(reconcileSessionPanelLayout(current, currentContext), currentContext),
      );
    },
    [layoutStore],
  );
  const { actions: terminalActions, terminalClose } = useSessionPanelTerminalTabs({
    ownerKey,
    latest,
    update,
    setBottomOpen,
    requestFocus,
  });
  const { addressFocus, actions: browserActions } = useSessionPanelBrowserTabs({
    ownerKey,
    isActive,
    layout,
    browser: ownerBrowser,
    latest,
    update,
    showRight,
  });

  const pendingBottomOpen = useRef<string | null>(null);
  const hasBottomEntries = layout.panels.bottom.length > 0;
  const { createTerminal, discoveryError, isLoading: isLoadingTerminals } = terminals;
  useEffect(() => {
    if (pendingBottomOpen.current === null) return;
    if (
      pendingBottomOpen.current !== ownerKey ||
      !isBottomOpen ||
      discoveryError !== null ||
      hasBottomEntries
    ) {
      pendingBottomOpen.current = null;
      return;
    }
    if (isLoadingTerminals || !context.hostTabs.terminal.synced) return;
    // Consume the open request once, so a later refresh cannot start a closed terminal again.
    pendingBottomOpen.current = null;
    const tabId = createTerminal();
    if (tabId !== null) {
      update((current, ctx) => appendPanelTab(current, ctx, "bottom", { kind: "terminal", tabId }));
    }
  }, [
    context.hostTabs.terminal.synced,
    createTerminal,
    discoveryError,
    hasBottomEntries,
    isBottomOpen,
    isLoadingTerminals,
    ownerKey,
    update,
  ]);

  const toggleBottomWith = useCallback(
    (motion: PanelMotion): void => {
      const current = latest.current;
      if (current.ownerKey === null) return;
      const opening = !current.isBottomOpen;
      pendingBottomOpen.current =
        opening &&
        current.layout.panels.bottom.length === 0 &&
        current.terminals.discoveryError === null
          ? current.ownerKey
          : null;
      setBottomOpen(opening, motion);
      if (opening) requestFocus("bottom");
    },
    [requestFocus, setBottomOpen],
  );
  const toggleBottom = useCallback((): void => toggleBottomWith("slide"), [toggleBottomWith]);

  useEffect(() => {
    if (!isActive || !shortcutsEnabled) return;
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!isTerminalToggleShortcut(event)) return;
      event.preventDefault();
      // A keyboard shortcut toggles the panel at once, as users press it many times a day.
      toggleBottomWith("instant");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isActive, shortcutsEnabled, toggleBottomWith]);

  const hideBottom = useCallback((): void => {
    pendingBottomOpen.current = null;
    setBottomOpen(false);
  }, [setBottomOpen]);
  // A drag already made the panel zero in size, so it hides without a slide.
  const collapseBottom = useCallback((): void => {
    pendingBottomOpen.current = null;
    setBottomOpen(false, "instant");
  }, [setBottomOpen]);
  const selectTab = useCallback(
    (panel: PanelId, entryId: string): void => {
      update((current, ctx) => selectPanelTab(current, ctx, panel, entryId));
      if (latest.current.tabs[panel].some((tab) => tab.id === entryId && tab.kind === "terminal")) {
        requestFocus(panel);
      }
    },
    [requestFocus, update],
  );
  const hostTabActions = useMemo<HostTabActionMap>(
    () => ({ terminal: terminalActions, browser: browserActions }),
    [browserActions, terminalActions],
  );
  const closeTab = useCallback(
    (panel: PanelId, entryId: string): void => {
      const tab = latest.current.tabs[panel].find((candidate) => candidate.id === entryId);
      if (!tab) return;
      if (isResolvedHostTab(tab)) {
        closeHostTab(hostTabActions, tab.kind, panel, tab);
        return;
      }
      update((current, ctx) => closePanelTab(current, ctx, panel, entryId));
    },
    [hostTabActions, update],
  );
  const addTab = useCallback(
    (panel: PanelId): void => update((current, ctx) => addNewPanelTab(current, ctx, panel)),
    [update],
  );
  const pickKind = useCallback(
    (panel: PanelId, kind: PanelTabKind): void => {
      if (isHostTabKind(kind)) {
        hostTabActions[kind].pick(panel);
        return;
      }
      update((current, ctx) => pickPanelTabKind(current, ctx, panel, { kind }));
    },
    [hostTabActions, update],
  );
  // The panels call this during render, so it reads the layout of the current render.
  const canMove = useCallback(
    (entryId: string, to: PanelId): boolean => canMovePanelTab(layout, context, entryId, to),
    [context, layout],
  );
  const dropTab = useCallback(
    (entryId: string, to: PanelId, target: PanelDropTarget): void => {
      const { layout: current, context: currentContext } = latest.current;
      const found = findPanelTab(current, entryId);
      if (!found || !canMovePanelTab(current, currentContext, entryId, to)) return;
      update((layoutState, ctx) => movePanelTab(layoutState, ctx, entryId, to, target));
      if (found.panel === to) return;
      if (to === "bottom") setBottomOpen(true);
      if (to === "right" && !latest.current.isRightOpen) toggleRight();
      if (found.entry.kind === "terminal") requestFocus(to);
    },
    [requestFocus, setBottomOpen, toggleRight, update],
  );
  const moveTab = useCallback(
    (entryId: string, to: PanelId): void => dropTab(entryId, to, null),
    [dropTab],
  );
  const runAction = useCallback(
    (action: RepoAction): void => {
      const tabId = latest.current.terminals.createTerminal(action);
      if (tabId === null) return;
      update((current, ctx) => appendPanelTab(current, ctx, "bottom", { kind: "terminal", tabId }));
      setBottomOpen(true);
      requestFocus("bottom");
    },
    [requestFocus, setBottomOpen, update],
  );

  const terminalMounts = useMemo(
    () => placeMountedTerminals(terminals.mountedTabs, ownerKey, layout, layouts),
    [layout, layouts, ownerKey, terminals.mountedTabs],
  );
  const actions: PanelActions = { selectTab, closeTab, addTab, pickKind, hideBottom };
  const terminalBlockedReason = terminals.startBlockedReason;
  const browserBlockedReason = browser?.startBlockedReason ?? null;
  const blockedReasons = useMemo<LauncherBlockedReasons>(
    () => ({ terminal: terminalBlockedReason, browser: browserBlockedReason }),
    [browserBlockedReason, terminalBlockedReason],
  );
  const shared = {
    context,
    layout,
    ownerKey,
    terminals,
    browserAddressFocus: addressFocus,
    blockedReasons,
    browserTabView: browser?.tabView ?? null,
  };
  const right = usePanelModel(
    "right",
    {
      ...shared,
      presence: visibility.presence.right,
      onSettled: visibility.settleRight,
      onCollapsed: visibility.hideRightAtOnce,
      tabs: rightTabs,
      selectedTabId: rightSelected,
      focusRequest: visibility.focusRequest.right,
      terminalMounts: terminalMounts.right,
    },
    actions,
  );
  const bottom = usePanelModel(
    "bottom",
    {
      ...shared,
      presence: visibility.presence.bottom,
      onSettled: visibility.settleBottom,
      onCollapsed: collapseBottom,
      tabs: bottomTabs,
      selectedTabId: bottomSelected,
      focusRequest: visibility.focusRequest.bottom,
      terminalMounts: terminalMounts.bottom,
    },
    actions,
  );
  const hasOwner = owner !== null;
  return useMemo(
    () => ({
      right,
      bottom,
      rightToggle: hasOwner ? { isOpen: isRightOpen, onToggle: toggleRight } : null,
      bottomToggle: { isAvailable: hasOwner, isOpen: isBottomOpen, onToggle: toggleBottom },
      runAction,
      startBlockedReason: terminals.startBlockedReason,
      canMove,
      onMove: moveTab,
      onDrop: dropTab,
      terminalClose,
      platformError: terminals.platformError,
    }),
    [
      bottom,
      canMove,
      dropTab,
      hasOwner,
      isBottomOpen,
      isRightOpen,
      moveTab,
      right,
      runAction,
      terminalClose,
      terminals.platformError,
      terminals.startBlockedReason,
      toggleBottom,
      toggleRight,
    ],
  );
}
