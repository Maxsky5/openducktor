import type { BrowserTabsStore } from "@openducktor/frontend-core/browser/browser-tabs-store";
import { withId, withoutId } from "./tab-id-set";

/**
 * The browser tabs that this client asked the host to close. All views of the app share them, so
 * every view of a task hides a closing tab. A tab leaves the set when the host list removes it, or
 * when its close fails.
 */
export const createBrowserClosingTabs = (store: Pick<BrowserTabsStore, "onChange">) => {
  let ids: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const set = (next: ReadonlySet<string>): void => {
    ids = next;
    for (const listener of listeners) listener();
  };
  const remove = (tabId: string): void => {
    if (!ids.has(tabId)) return;
    set(withoutId(ids, tabId));
  };
  store.onChange((change) => {
    if (change.kind === "tab_closed") remove(change.tabId);
  });
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ids: (): ReadonlySet<string> => ids,
    add(tabId: string): void {
      if (ids.has(tabId)) return;
      set(withId(ids, tabId));
    },
    remove,
  };
};

export type BrowserClosingTabs = ReturnType<typeof createBrowserClosingTabs>;
