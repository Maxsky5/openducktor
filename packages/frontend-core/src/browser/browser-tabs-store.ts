import type {
  BrowserEngineState,
  BrowserHostEvent,
  BrowserNotice,
  BrowserTabOwner,
  BrowserTabSummary,
} from "@openducktor/contracts";
import {
  CONNECTION_RECONNECTED_EVENT_KIND,
  type ConnectionControlEvent,
} from "../recovery/connection-control-events";
import { errorMessage } from "../lib/errors";

export type BrowserTabsSnapshot = {
  status: "loading" | "ready" | "error";
  error: string | null;
  engine: BrowserEngineState | null;
  tabs: ReadonlyMap<string, BrowserTabSummary>;
};

export type BrowserTabsReads = {
  /** True for a tab that this client shows. The store ignores the other tabs and their notices. */
  shows(tab: BrowserTabSummary): boolean;
  readTabs(): Promise<BrowserTabSummary[]>;
  readEngine(): Promise<BrowserEngineState>;
  subscribe(
    listener: (event: BrowserHostEvent | ConnectionControlEvent) => void,
  ): Promise<() => void>;
};

export type BrowserTabsChange =
  | { kind: "tab_added"; tab: BrowserTabSummary }
  /** A known tab has a newer summary, for example after a navigation. */
  | { kind: "tab_updated"; tab: BrowserTabSummary }
  | { kind: "tab_closed"; tabId: string; owner: BrowserTabOwner }
  | { kind: "notice"; tabId: string; owner: BrowserTabOwner; notice: BrowserNotice }
  /** The host could not save the tab list. */
  | { kind: "tabs_not_saved"; message: string };

const INITIAL: BrowserTabsSnapshot = {
  status: "loading",
  error: null,
  engine: null,
  tabs: new Map(),
};

const isControlEvent = (
  event: BrowserHostEvent | ConnectionControlEvent,
): event is ConnectionControlEvent => "__openducktorConnectionControl" in event;

/**
 * The live browser tabs of the host. It subscribes to browser events first, then reads the tab
 * list and the engine state, so no change between them is lost. Each tab keeps the summary with
 * the higher revision. An event that comes during a read is newer than the read, so a tab that it
 * adds or closes keeps that state. Only the latest read applies. A web runner reconnect that
 * missed events reads the baseline again.
 */
export const createBrowserTabsStore = (reads: BrowserTabsReads) => {
  let snapshot = INITIAL;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;
  /** Counts baseline reads. Only the latest read applies its result. */
  let readCount = 0;
  /** Tabs that an event added or changed while the baseline read ran. The read can miss them. */
  let upsertedDuringRead = new Set<string>();
  /** Tabs that closed while the baseline read ran. The read can still list them. */
  let closedDuringRead = new Set<string>();
  /** True when an engine event arrived while the baseline read ran. The event is newer. */
  let engineChangedDuringRead = false;
  /** Tabs of the host that this client does not show. */
  const hiddenTabs = new Set<string>();
  /**
   * Tabs whose state came from the host since the latest baseline read began. Only their
   * revisions compare: a host restart starts each tab revision again at 1.
   */
  let fresh = new Set<string>();
  const listeners = new Set<() => void>();
  const changeListeners = new Set<(change: BrowserTabsChange) => void>();

  const set = (next: BrowserTabsSnapshot): void => {
    snapshot = next;
    for (const listener of Array.from(listeners)) listener();
  };

  const emit = (change: BrowserTabsChange): void => {
    for (const listener of Array.from(changeListeners)) listener(change);
  };

  const upsert = (tab: BrowserTabSummary): void => {
    if (!reads.shows(tab)) {
      hiddenTabs.add(tab.tabId);
      return;
    }
    upsertedDuringRead.add(tab.tabId);
    const current = snapshot.tabs.get(tab.tabId);
    if (current && fresh.has(tab.tabId) && current.revision >= tab.revision) return;
    fresh.add(tab.tabId);
    const tabs = new Map(snapshot.tabs);
    tabs.set(tab.tabId, tab);
    set({ ...snapshot, tabs });
    emit(current ? { kind: "tab_updated", tab } : { kind: "tab_added", tab });
  };

  const remove = (tabId: string, owner: BrowserTabOwner): void => {
    if (hiddenTabs.delete(tabId)) return;
    closedDuringRead.add(tabId);
    if (snapshot.tabs.has(tabId)) {
      const tabs = new Map(snapshot.tabs);
      tabs.delete(tabId);
      set({ ...snapshot, tabs });
    }
    emit({ kind: "tab_closed", tabId, owner });
  };

  const readBaseline = async (readGeneration: number): Promise<void> => {
    readCount += 1;
    const read = readCount;
    upsertedDuringRead = new Set();
    closedDuringRead = new Set();
    engineChangedDuringRead = false;
    fresh = new Set();
    try {
      const [listed, engine] = await Promise.all([reads.readTabs(), reads.readEngine()]);
      if (readGeneration !== generation || read !== readCount) return;
      const tabs = listed.filter((tab) => {
        if (reads.shows(tab)) return true;
        hiddenTabs.add(tab.tabId);
        return false;
      });
      const next = new Map<string, BrowserTabSummary>();
      for (const tab of tabs) {
        if (closedDuringRead.has(tab.tabId)) continue;
        // An event during the read can be newer than the list. Older state is not: it can come from
        // a host that restarted since.
        const known = snapshot.tabs.get(tab.tabId);
        next.set(
          tab.tabId,
          known && fresh.has(tab.tabId) && known.revision > tab.revision ? known : tab,
        );
      }
      for (const tabId of upsertedDuringRead) {
        const live = snapshot.tabs.get(tabId);
        if (live && !next.has(tabId)) next.set(tabId, live);
      }
      const removed = Array.from(snapshot.tabs.values()).filter((tab) => !next.has(tab.tabId));
      const added = tabs.filter((tab) => !snapshot.tabs.has(tab.tabId) && next.has(tab.tabId));
      const updated = Array.from(next.values()).filter((tab) => {
        const previous = snapshot.tabs.get(tab.tabId);
        return previous !== undefined && previous !== tab;
      });
      fresh = new Set(next.keys());
      set({
        status: "ready",
        error: null,
        engine: engineChangedDuringRead ? snapshot.engine : engine,
        tabs: next,
      });
      for (const tab of removed) emit({ kind: "tab_closed", tabId: tab.tabId, owner: tab.owner });
      for (const tab of added) emit({ kind: "tab_added", tab });
      for (const tab of updated) emit({ kind: "tab_updated", tab });
    } catch (cause) {
      if (readGeneration !== generation || read !== readCount) return;
      set({ ...snapshot, status: "error", error: errorMessage(cause) });
    }
  };

  const handleEvent = (event: BrowserHostEvent | ConnectionControlEvent): void => {
    if (isControlEvent(event)) {
      if (event.kind === CONNECTION_RECONNECTED_EVENT_KIND && event.missedEvents) {
        void readBaseline(generation);
      }
      return;
    }
    switch (event.type) {
      case "tab_upserted":
        upsert(event.tab);
        return;
      case "tab_closed":
        remove(event.tabId, event.owner);
        return;
      case "engine_changed":
        engineChangedDuringRead = true;
        set({ ...snapshot, engine: event.state });
        return;
      case "notice":
        if (hiddenTabs.has(event.tabId)) return;
        emit({ kind: "notice", tabId: event.tabId, owner: event.owner, notice: event.notice });
        return;
      case "tabs_not_saved":
        emit({ kind: "tabs_not_saved", message: event.message });
        return;
    }
  };

  return {
    getSnapshot: (): BrowserTabsSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onChange(listener: (change: BrowserTabsChange) => void): () => void {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    /** Resolves once the tab list has the tab, or once the tab closes. */
    untilListed(tabId: string): Promise<void> {
      return new Promise((resolve) => {
        if (snapshot.tabs.has(tabId)) {
          resolve();
          return;
        }
        const listener = (change: BrowserTabsChange): void => {
          const closedTabId = change.kind === "tab_closed" ? change.tabId : null;
          const addedTabId = change.kind === "tab_added" ? change.tab.tabId : null;
          if (closedTabId !== tabId && addedTabId !== tabId) return;
          changeListeners.delete(listener);
          resolve();
        };
        changeListeners.add(listener);
      });
    },
    async start(): Promise<void> {
      generation += 1;
      const startGeneration = generation;
      set({ ...INITIAL, tabs: snapshot.tabs });
      try {
        const stop = await reads.subscribe(handleEvent);
        if (startGeneration !== generation) {
          stop();
          return;
        }
        unsubscribe = stop;
      } catch (cause) {
        set({ ...snapshot, status: "error", error: errorMessage(cause) });
        return;
      }
      await readBaseline(startGeneration);
    },

    stop(): void {
      generation += 1;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
};

export type BrowserTabsStore = ReturnType<typeof createBrowserTabsStore>;
