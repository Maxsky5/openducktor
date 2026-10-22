import { create } from "zustand";

/** The share of the page area that docked DevTools take when they first open, in percent. */
export const BROWSER_DEVTOOLS_DEFAULT_SIZE = 40;

export type BrowserDevToolsDock = {
  readonly open: boolean;
  /** The DevTools size in percent of the page area. It stays when DevTools close. */
  readonly size: number;
};

type BrowserDevToolsState = {
  /** The docked DevTools of browser tabs that opened DevTools, by browser tab ID. */
  docks: Readonly<Record<string, BrowserDevToolsDock>>;
  toggle(tabId: string): void;
  close(tabId: string): void;
  resize(tabId: string, size: number): void;
  /** Removes the DevTools of a closed browser tab. */
  forget(tabId: string): void;
};

/**
 * The docked DevTools of browser tabs. The state lives only in memory: DevTools close when the app
 * reloads, like in a browser.
 */
export const useBrowserDevToolsStore = create<BrowserDevToolsState>((set) => ({
  docks: {},
  toggle: (tabId) =>
    set(({ docks }) => {
      const dock = docks[tabId];
      return {
        docks: {
          ...docks,
          [tabId]: dock
            ? { ...dock, open: !dock.open }
            : { open: true, size: BROWSER_DEVTOOLS_DEFAULT_SIZE },
        },
      };
    }),
  close: (tabId) =>
    set(({ docks }) => {
      const dock = docks[tabId];
      if (!dock?.open) return { docks };
      return { docks: { ...docks, [tabId]: { ...dock, open: false } } };
    }),
  resize: (tabId, size) =>
    set(({ docks }) => {
      const dock = docks[tabId];
      if (!dock || dock.size === size) return { docks };
      return { docks: { ...docks, [tabId]: { ...dock, size } } };
    }),
  forget: (tabId) =>
    set(({ docks }) => {
      if (!docks[tabId]) return { docks };
      const { [tabId]: _closed, ...rest } = docks;
      return { docks: rest };
    }),
}));
