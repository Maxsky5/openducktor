import {
  BROWSER_BLANK_URL,
  type BrowserTabSummary,
  isBrowserNavigableUrl,
} from "@openducktor/contracts";
import { type ReactElement, useMemo, useSyncExternalStore } from "react";
import { useBrowserRecentPages } from "./browser-recent-pages";
import { useBrowserTabs } from "./browser-runtime";
import { type BrowserNewTabPage, BrowserNewTabView } from "./components/browser-new-tab-view";

/** The pages that other tabs of the workspace show, at most this many. */
const OPEN_PAGES_LIMIT = 8;

/** True for a tab with no address, which shows the new tab page in place of a blank page. */
export const showsBrowserNewTab = (tab: BrowserTabSummary): boolean =>
  tab.url === BROWSER_BLANK_URL && !tab.loading && tab.error === null;

/** The new tab page of a tab, with the recent pages and open tabs of its workspace. */
export function BrowserNewTab({
  tab,
  onOpen,
}: {
  tab: BrowserTabSummary;
  onOpen: (url: string) => void;
}): ReactElement {
  const { workspaceId } = tab.owner;
  const recentPages = useBrowserRecentPages();
  const recent = useSyncExternalStore(recentPages.subscribe, () => recentPages.read(workspaceId));
  const { tabs } = useBrowserTabs();
  const open = useMemo(() => {
    const recentUrls = new Set(recent.map((page) => page.url));
    const pages = new Map<string, BrowserNewTabPage>();
    for (const other of tabs.values()) {
      if (other.tabId === tab.tabId || other.owner.workspaceId !== workspaceId) continue;
      if (!isBrowserNavigableUrl(other.url) || recentUrls.has(other.url)) continue;
      pages.set(other.url, { url: other.url, title: other.title, favicon: other.favicon });
    }
    return [...pages.values()].slice(0, OPEN_PAGES_LIMIT);
  }, [recent, tab.tabId, tabs, workspaceId]);
  return <BrowserNewTabView recent={recent} open={open} onOpen={onOpen} />;
}
