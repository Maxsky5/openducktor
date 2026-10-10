import type { RepoAction } from "@openducktor/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  isTerminalToggleShortcut,
  type MountedTerminal,
  type TerminalCloseDialogModel,
  type TerminalSessionsModel,
  type TerminalTab,
} from "@/features/terminals";
import {
  PANEL_TAB_KINDS,
  type PanelId,
  type PanelTabKind,
  type ToolTabKind,
} from "./panel-tab-kinds";
import {
  addNewPanelTab,
  appendTerminalPanelTab,
  canMovePanelTab,
  canPlacePanelTab,
  closePanelTab,
  emptySessionPanelLayout,
  findPanelTab,
  findTerminalEntry,
  movePanelTab,
  type PanelDropTarget,
  pickPanelTabKind,
  reconcileSessionPanelLayout,
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
import {
  readSessionPanelLayout,
  sessionPanelLayoutsSnapshot,
  subscribeSessionPanelLayouts,
  takeSessionPanelLayoutReadError,
  updateSessionPanelLayout,
} from "./session-panel-layout-store";
import {
  type LatestPanelState,
  useSessionPanelTerminalClose,
} from "./use-session-panel-terminal-close";
import {
  type PanelMotion,
  type PanelPresence,
  useSessionPanelVisibility,
} from "./use-session-panel-visibility";

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
};

type LatestControllerState = LatestPanelState & {
  owner: SessionPanelOwner | null;
  context: SessionPanelContext;
  layout: SessionPanelLayout;
  isRightOpen: boolean;
  isBottomOpen: boolean;
};

const EMPTY_LAYOUT = emptySessionPanelLayout();
const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = [];
const EMPTY_TAB_IDS: ReadonlySet<string> = new Set();
const NO_UNAVAILABLE_KINDS: ReadonlySet<ToolTabKind> = new Set();
const EMPTY_LAYOUT_SNAPSHOT = (): SessionPanelLayout => EMPTY_LAYOUT;

/** The kinds that a panel can open now. An open unique kind has no entry, because its tab shows. */
const launcherFor = (
  panel: PanelId,
  layout: SessionPanelLayout,
  context: SessionPanelContext,
  terminalStartBlockedReason: string | null,
): PanelLauncherEntry[] =>
  PANEL_TAB_KINDS.flatMap((kind): PanelLauncherEntry[] => {
    if (kind !== "terminal" && context.unavailableKinds.has(kind)) return [];
    if (!canPlacePanelTab(layout, context, kind, panel)) return [];
    return [{ kind, disabledReason: kind === "terminal" ? terminalStartBlockedReason : null }];
  });

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
    terminals: TerminalSessionsModel;
    terminalMounts: MountedTerminal[];
  },
  actions: PanelActions,
): SessionPanelModel => {
  const { presence, onSettled, onCollapsed, layout, tabs, selectedTabId, context, ownerKey } =
    state;
  const { focusRequest, terminals, terminalMounts } = state;
  const { selectTab, closeTab, addTab, pickKind, hideBottom } = actions;
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
      launcher: launcherFor(panel, layout, context, terminals.startBlockedReason),
      focusRequest,
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
    };
  }, [
    addTab,
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
    tabs,
    terminalMounts,
    terminals,
  ]);
};

/** Reads the layout of the owner from the store, and saves reconcile results and read errors. */
const useOwnerLayout = (owner: SessionPanelOwner | null, context: SessionPanelContext) => {
  const ownerKey = owner ? sessionPanelOwnerKey(owner) : null;
  const readOwnerLayout = useMemo(
    () => (owner ? () => readSessionPanelLayout(owner) : EMPTY_LAYOUT_SNAPSHOT),
    [owner],
  );
  const storedLayout = useSyncExternalStore(subscribeSessionPanelLayouts, readOwnerLayout);
  const layouts = useSyncExternalStore(subscribeSessionPanelLayouts, sessionPanelLayoutsSnapshot);
  const layout = useMemo(
    () => (owner ? reconcileSessionPanelLayout(storedLayout, context) : EMPTY_LAYOUT),
    [context, owner, storedLayout],
  );

  // Write reconcile results back, so a later page mount keeps the terminal positions. A store change
  // after this render, such as a new terminal tab, wins, and the next render reconciles it.
  useEffect(() => {
    if (!owner || layout === storedLayout) return;
    updateSessionPanelLayout(owner, (current) => (current === storedLayout ? layout : current));
  }, [layout, owner, storedLayout]);

  const ownerRef = useRef(owner);
  useLayoutEffect(() => {
    ownerRef.current = owner;
  });
  useEffect(() => {
    const current = ownerRef.current;
    if (!current || ownerKey === null) return;
    const error = takeSessionPanelLayoutReadError(current);
    if (error) {
      toast.error("Could not restore the saved panel layout", {
        description: `${error} The default layout is shown.`,
      });
    }
  }, [ownerKey]);

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
}: SessionPanelsInput): SessionPanelsModel {
  const ownerKey = owner ? sessionPanelOwnerKey(owner) : null;
  const isOwnerTerminals = ownerKey !== null && terminals.scopeKey === ownerKey;
  const context = useMemo<SessionPanelContext>(
    () => ({
      ownerKind: owner?.kind ?? "task",
      selectionKey,
      unavailableKinds,
      terminalTabs: isOwnerTerminals ? terminals.tabs : EMPTY_TERMINAL_TABS,
      closingTabIds: isOwnerTerminals ? terminals.closingTabIds : EMPTY_TAB_IDS,
      terminalTabsSynced: isOwnerTerminals && terminals.isSynced,
    }),
    [
      isOwnerTerminals,
      owner?.kind,
      selectionKey,
      terminals.closingTabIds,
      terminals.isSynced,
      terminals.tabs,
      unavailableKinds,
    ],
  );
  const { layout, layouts } = useOwnerLayout(owner, context);
  const rightTabs = useMemo(() => shownPanelTabs(layout, "right", context), [context, layout]);
  const bottomTabs = useMemo(() => shownPanelTabs(layout, "bottom", context), [context, layout]);
  const visibility = useSessionPanelVisibility(ownerKey, bottomTabs);
  const { isRightOpen, isBottomOpen, setBottomOpen, toggleRight, requestFocus } = visibility;
  const rightSelected = selectedPanelTabId(layout, "right", context, rightTabs);
  const bottomSelected = selectedPanelTabId(layout, "bottom", context, bottomTabs);

  const latestState: LatestControllerState = {
    owner,
    ownerKey,
    context,
    layout,
    terminals,
    isRightOpen,
    isBottomOpen,
    tabs: { right: rightTabs, bottom: bottomTabs },
    selected: { right: rightSelected, bottom: bottomSelected },
  };
  const latest = useRef(latestState);
  useLayoutEffect(() => {
    latest.current = latestState;
  });

  const update = useCallback<SessionPanelLayoutUpdate>((mutate) => {
    const { owner: currentOwner, context: currentContext } = latest.current;
    if (!currentOwner) return;
    updateSessionPanelLayout(currentOwner, (current) =>
      mutate(reconcileSessionPanelLayout(current, currentContext), currentContext),
    );
  }, []);
  const { closeTerminalTab, terminalClose } = useSessionPanelTerminalClose({
    ownerKey,
    latest,
    update,
    setBottomOpen,
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
    if (isLoadingTerminals || !context.terminalTabsSynced) return;
    // Consume the open request once, so a later refresh cannot start a closed terminal again.
    pendingBottomOpen.current = null;
    const tabId = createTerminal();
    if (tabId !== null) {
      update((current, ctx) => appendTerminalPanelTab(current, ctx, "bottom", tabId));
    }
  }, [
    context.terminalTabsSynced,
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
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!isTerminalToggleShortcut(event)) return;
      event.preventDefault();
      // A keyboard shortcut toggles the panel at once, as users press it many times a day.
      toggleBottomWith("instant");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleBottomWith]);

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
  const closeTab = useCallback(
    (panel: PanelId, entryId: string): void => {
      const tab = latest.current.tabs[panel].find((candidate) => candidate.id === entryId);
      if (!tab) return;
      if (tab.kind === "terminal") {
        void closeTerminalTab(panel, entryId, tab.terminal, false);
        return;
      }
      update((current, ctx) => closePanelTab(current, ctx, panel, entryId));
    },
    [closeTerminalTab, update],
  );
  const addTab = useCallback(
    (panel: PanelId): void => update((current, ctx) => addNewPanelTab(current, ctx, panel)),
    [update],
  );
  const pickKind = useCallback(
    (panel: PanelId, kind: PanelTabKind): void => {
      if (kind !== "terminal") {
        update((current, ctx) => pickPanelTabKind(current, ctx, panel, { kind }));
        return;
      }
      const current = latest.current;
      if (current.terminals.scopeKey !== current.ownerKey) return;
      const tabId = current.terminals.createTerminal();
      if (tabId === null) return;
      update((layoutState, ctx) =>
        pickPanelTabKind(layoutState, ctx, panel, { kind: "terminal", tabId }),
      );
      requestFocus(panel);
    },
    [requestFocus, update],
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
      update((current, ctx) => appendTerminalPanelTab(current, ctx, "bottom", tabId));
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
  const shared = { context, layout, ownerKey, terminals };
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
