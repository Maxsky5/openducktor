import type { BrowserTabSummary } from "@openducktor/contracts";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { registerInAppLinkTarget } from "@/lib/link-open";
import type { PanelId } from "./panel-tab-kinds";
import {
  appendPanelTab,
  canPlacePanelTab,
  type HostTabActions,
  pickPanelTabKind,
  type ResolvedBrowserTab,
  type SessionPanelContext,
  type SessionPanelLayout,
  type SessionPanelLayoutUpdate,
  selectPanelTab,
  selectPanelTabNeighbor,
} from "./session-panel-layout";
import { browserPageLabel } from "./session-panel-browser-tab-presentation";

/** What the panel gives the view of one browser tab. */
export type BrowserTabViewProps = {
  tab: ResolvedBrowserTab;
  /** True while the panel shows the tab: the tab is selected and its panel is open. */
  isShown: boolean;
  /**
   * Grows each time the address bar of this browser tab must take keyboard focus, such as after
   * the user opens the tab from the launcher. Zero when it never must.
   */
  addressFocusRequest: number;
};

/** Renders the content of a browser tab. The browser feature fills this slot. */
export type BrowserTabView = (props: BrowserTabViewProps) => ReactNode;

/** The browser tabs of the selected owner, from the browser feature. */
export type SessionPanelBrowserModel = {
  /** The `sessionPanelOwnerKey` of the owner of `tabs`. */
  scopeKey: string;
  /** Renders the content of a browser tab. */
  tabView: BrowserTabView;
  /** The browser tabs of the owner, from the host. */
  tabs: readonly BrowserTabSummary[];
  /**
   * True when `tabs` is the latest host list of the owner. Before that, the panels keep their
   * saved browser tabs as they are.
   */
  isSynced: boolean;
  /** Why the Browser card cannot open a tab now, such as the tab limit, or null when it can. */
  startBlockedReason: string | null;
  /** Tabs that `openTab` opens now. Their entries stay before the host lists them. */
  openingTabIds: ReadonlySet<string>;
  /** Tabs that `closeTab` closes now. They hide until the host list no longer has them. */
  closingTabIds: ReadonlySet<string>;
  /**
   * Opens a new tab with this ID, at an address or blank. The panel placed its entry before the
   * call. While the engine is not ready, the browser feature keeps the request until the engine is
   * ready. Resolves when the host list has the tab. It reports a failure, then rejects.
   */
  openTab: (tabId: string, address: string | null) => Promise<void>;
  /**
   * Gives a saved tab its page. The panels ask once for each tab of the owner that has not
   * started. While the engine is not ready, the browser feature keeps the request.
   */
  startTab: (tabId: string) => void;
  /**
   * Closes a tab. The tab hides at once and leaves when the host list no longer has it. Resolves
   * when the host has no such tab. A rejection shows the tab again and reports the error.
   */
  closeTab: (tabId: string) => Promise<void>;
};

/** Asks the address bar of a new browser tab to take keyboard focus. */
export type BrowserAddressFocus = { tabId: string; request: number };

export type LatestBrowserState = {
  ownerKey: string | null;
  /** The browser model of the owner, or null when the page has none for the owner. */
  browser: SessionPanelBrowserModel | null;
  layout: SessionPanelLayout;
  context: SessionPanelContext;
  selected: Record<PanelId, string | null>;
  isRightOpen: boolean;
};

type SessionPanelBrowserTabs = {
  addressFocus: BrowserAddressFocus | null;
  /** A pick opens a new blank browser tab in place of the New tab of the panel. */
  actions: HostTabActions<"browser">;
};

/**
 * Connects the browser tabs of the panels to the browser feature: it opens, starts, and closes
 * tabs, shows the right panel when an agent opens a tab, and opens the links of the page in new
 * tabs.
 */
export function useSessionPanelBrowserTabs({
  ownerKey,
  layout,
  browser,
  latest,
  update,
  showRight,
}: {
  ownerKey: string | null;
  layout: SessionPanelLayout;
  /** The browser model of the owner, or null when the page has none for the owner. */
  browser: SessionPanelBrowserModel | null;
  latest: RefObject<LatestBrowserState>;
  update: SessionPanelLayoutUpdate;
  showRight: () => void;
}): SessionPanelBrowserTabs {
  const [addressFocus, setAddressFocus] = useState<BrowserAddressFocus | null>(null);
  // Tabs that the panels asked to start. A tab that keeps failing waits for the user.
  const startedTabIds = useRef(new Set<string>());

  const isSynced = browser?.isSynced ?? false;
  const closingTabIds = browser?.closingTabIds;
  useEffect(() => {
    if (!isSynced || browser === null) return;
    const started = startedTabIds.current;
    for (const tab of browser.tabs) {
      // A frame page loads in the app, so only host pages start.
      if (tab.started || tab.page === "frame") {
        started.delete(tab.tabId);
        continue;
      }
      if (started.has(tab.tabId) || closingTabIds?.has(tab.tabId)) continue;
      started.add(tab.tabId);
      browser.startTab(tab.tabId);
    }
  }, [browser, closingTabIds, isSynced]);

  // The agent tabs of the last render, so a new agent tab can show the right panel once.
  const knownAgentTabs = useRef<{ ownerKey: string | null; tabIds: ReadonlySet<string> }>({
    ownerKey: null,
    tabIds: new Set(),
  });
  useEffect(() => {
    const known = knownAgentTabs.current;
    const agentTabIds = new Set(
      (browser?.tabs ?? [])
        .filter((tab) => tab.createdBy === "agent" && tab.started)
        .map((tab) => tab.tabId),
    );
    knownAgentTabs.current = { ownerKey, tabIds: agentTabIds };
    if (known.ownerKey !== ownerKey) return;
    const rightTabIds = new Set(
      layout.panels.right.flatMap((entry) => (entry.kind === "browser" ? [entry.tabId] : [])),
    );
    const hasNewAgentTab = [...agentTabIds].some(
      (tabId) => !known.tabIds.has(tabId) && rightTabIds.has(tabId),
    );
    // The panel shows without a focus request, so keyboard focus stays where the user has it.
    if (hasNewAgentTab && !latest.current.isRightOpen) showRight();
  }, [browser, latest, layout, ownerKey, showRight]);

  const pickBrowser = useCallback(
    (panel: PanelId): void => {
      const current = latest.current;
      const currentBrowser = current.browser;
      if (
        currentBrowser === null ||
        currentBrowser.startBlockedReason !== null ||
        !canPlacePanelTab(current.layout, current.context, "browser", panel)
      ) {
        return;
      }
      const tabId = globalThis.crypto.randomUUID();
      // The entry stays while the tab opens. After a failure, it leaves with the next reconcile.
      currentBrowser.openTab(tabId, null).catch(() => undefined);
      update((layoutState, ctx) =>
        pickPanelTabKind(layoutState, ctx, panel, { kind: "browser", tabId }),
      );
      setAddressFocus((focus) => ({ tabId, request: (focus?.request ?? 0) + 1 }));
    },
    [latest, update],
  );

  const closeBrowserTab = useCallback(
    async (panel: PanelId, tab: ResolvedBrowserTab): Promise<void> => {
      const { browser: currentBrowser, ownerKey: startOwnerKey, selected } = latest.current;
      if (currentBrowser === null) return;
      const { tabId } = tab.entry;
      const wasSelected = selected[panel] === tab.id;
      // The tab hides while the host closes it.
      update((current, context) => selectPanelTabNeighbor(current, context, panel, tab.id));
      try {
        await currentBrowser.closeTab(tabId);
      } catch (cause) {
        toast.error(`Could not close ${browserPageLabel(tab)}`, {
          description: errorMessage(cause),
        });
        if (wasSelected && latest.current.ownerKey === startOwnerKey) {
          update((current, context) => selectPanelTab(current, context, panel, tab.id));
        }
      }
    },
    [latest, update],
  );

  /** Opens a link in a new tab at the end of the right panel, and shows the panel. */
  const openBrowserPage = useCallback(
    async (url: string): Promise<void> => {
      const current = latest.current;
      const currentBrowser = current.browser;
      if (currentBrowser === null) throw new Error("This page has no browser tabs.");
      if (currentBrowser.startBlockedReason !== null) {
        throw new Error(currentBrowser.startBlockedReason);
      }
      if (!canPlacePanelTab(current.layout, current.context, "browser", "right")) {
        throw new Error("The right panel of this page cannot hold a browser tab.");
      }
      const tabId = globalThis.crypto.randomUUID();
      const opened = currentBrowser.openTab(tabId, url);
      update((layoutState, ctx) =>
        appendPanelTab(layoutState, ctx, "right", { kind: "browser", tabId }),
      );
      if (!current.isRightOpen) showRight();
      await opened;
    },
    [latest, showRight, update],
  );

  // Links of the page, such as chat and terminal links, can open in its browser tabs.
  const hasTabs = browser !== null;
  const blockedReason = browser?.startBlockedReason ?? null;
  useEffect(() => {
    if (!hasTabs) return;
    return registerInAppLinkTarget({ blockedReason, open: openBrowserPage });
  }, [blockedReason, hasTabs, openBrowserPage]);

  const actions = useMemo<HostTabActions<"browser">>(
    () => ({ pick: pickBrowser, close: (panel, tab) => void closeBrowserTab(panel, tab) }),
    [closeBrowserTab, pickBrowser],
  );
  return { addressFocus, actions };
}
