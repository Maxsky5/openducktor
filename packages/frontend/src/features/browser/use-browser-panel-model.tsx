import {
  BROWSER_TAB_LIMIT,
  browserEngineNotReadyMessage,
  type BrowserTabOwner,
  browserTabOwnerKey,
} from "@openducktor/contracts";
import { HostBrowserClientError } from "@openducktor/host-client";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type BrowserTabView,
  type SessionPanelBrowserModel,
  sessionPanelOwnerKey,
} from "@/features/session-panels";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { BrowserBridge } from "@/lib/shell-bridge";
import { BROWSER_TABS_NEED_LOCAL_APP } from "./browser-frame-display";
import { useBrowserRuntime, useBrowserTabs } from "./browser-runtime";
import { BrowserTabContent } from "./browser-tab-content";
import { browserTabPanelOwner } from "./browser-tab-placement";
import type { BrowserTabsSnapshot } from "@openducktor/frontend-core/browser/browser-tabs-store";

/** The browser tabs of one task or Workspace Session, for its session panels. */
export const useBrowserPanelModel = (
  owner: BrowserTabOwner | null,
): SessionPanelBrowserModel | null => {
  const runtime = useBrowserRuntime();
  const snapshot = useBrowserTabs();
  const ownerKey = owner === null ? null : browserTabOwnerKey(owner);
  const [openingTabIds, setOpeningTabIds] = useState<ReadonlySet<string>>(NO_TAB_IDS);
  const [closingTabIds, setClosingTabIds] = useState<ReadonlySet<string>>(NO_TAB_IDS);

  const openTab = useCallback(
    (tabId: string, address: string | null, tabOwner: BrowserTabOwner): Promise<void> => {
      setOpeningTabIds((ids) => withId(ids, tabId));
      return runtime.requests
        .open({ owner: tabOwner, tabId, address })
        .then(() => runtime.store.untilListed(tabId))
        .catch((cause: unknown) => {
          toast.error("Could not open the browser tab", { description: errorMessage(cause) });
          throw cause;
        })
        .finally(() => setOpeningTabIds((ids) => withoutId(ids, tabId)));
    },
    [runtime],
  );

  // A closed tab stays hidden: it leaves when the host list no longer has it.
  const closeTab = useCallback(
    (tabId: string): Promise<void> => {
      setClosingTabIds((ids) => withId(ids, tabId));
      return runtime.requests.close(tabId).catch((cause: unknown) => {
        setClosingTabIds((ids) => withoutId(ids, tabId));
        throw cause;
      });
    },
    [runtime],
  );

  const tabs = useMemo(
    () =>
      ownerKey === null
        ? []
        : Array.from(snapshot.tabs.values()).filter(
            (tab) => browserTabOwnerKey(tab.owner) === ownerKey,
          ),
    [snapshot.tabs, ownerKey],
  );

  return useMemo(() => {
    if (owner === null) return null;
    const panelOwner = browserTabPanelOwner(owner);
    const engine = snapshot.engine;
    return {
      scopeKey: sessionPanelOwnerKey(panelOwner),
      tabView: renderBrowserPanelTab,
      tabs,
      isSynced: snapshot.status === "ready" && engine !== null,
      startBlockedReason: browserStartBlockedReason(snapshot, tabs.length, runtime.bridge),
      openingTabIds,
      closingTabIds,
      openTab: (tabId, address) => openTab(tabId, address, owner),
      startTab: (tabId) => {
        runtime.requests.start(tabId).catch((cause: unknown) => {
          // The tab shows a host failure, and a missing tab leaves the panel.
          if (cause instanceof HostBrowserClientError) return;
          toast.error("Could not load the browser tab", { description: errorMessage(cause) });
        });
      },
      closeTab,
    } satisfies SessionPanelBrowserModel;
  }, [closeTab, closingTabIds, openTab, openingTabIds, owner, runtime, snapshot, tabs]);
};

const NO_TAB_IDS: ReadonlySet<string> = new Set();

const withId = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set([...ids, id]);

const withoutId = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...ids].filter((candidate) => candidate !== id));

/**
 * Why the Browser card cannot open a tab now. The engine matters only in Electron: web runner tabs
 * show their pages in iframes of this browser.
 */
const browserStartBlockedReason = (
  snapshot: BrowserTabsSnapshot,
  ownerTabCount: number,
  bridge: BrowserBridge,
): string | null => {
  const { engine } = snapshot;
  if (bridge.surface === "frame" && bridge.frames === null) {
    return BROWSER_TABS_NEED_LOCAL_APP;
  }
  if (snapshot.status === "error") {
    return `Browser tabs are not available: ${snapshot.error ?? "the host did not answer."}`;
  }
  if (snapshot.status === "loading" || engine === null) {
    return "Browser tabs are loading.";
  }
  if (bridge.surface === "webview" && engine.kind !== "ready") {
    return browserEngineNotReadyMessage(engine);
  }
  if (ownerTabCount >= BROWSER_TAB_LIMIT) {
    return `Close a browser tab to open another. The limit is ${BROWSER_TAB_LIMIT} browser tabs.`;
  }
  return null;
};

/** Fills the browser tabs of session panels. */
const renderBrowserPanelTab: BrowserTabView = ({ tab, isShown, addressFocusRequest }) => (
  <BrowserTabContent
    entry={tab.entry}
    tab={tab.tab}
    isShown={isShown}
    addressFocusRequest={addressFocusRequest}
  />
);
