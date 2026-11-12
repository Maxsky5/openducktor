"use client";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { RootProvider } from "fumadocs-ui/provider/next";
import { lazy, type ReactNode, useEffect } from "react";
import { AppearanceProvider } from "./appearance";
import { IntentLink } from "./intent-link";
import { SEARCH_TAP } from "./search-tap";

type SearchDialogModule = typeof import("./search-dialog");

let searchDialog: Promise<SearchDialogModule> | undefined;

/**
 * Loads the search dialog and its index client once. A load that fails leaves no promise, so the
 * next attempt loads the dialog again.
 */
function loadSearchDialog(): Promise<SearchDialogModule> {
  if (searchDialog) return searchDialog;
  const load = import("./search-dialog");
  searchDialog = load;
  load.catch(() => {
    searchDialog = undefined;
  });
  return load;
}

/** The search dialog loads when the reader opens search for the first time. */
const DocsSearchDialog = lazy(loadSearchDialog);

/** The search buttons of the header and the navigation. */
const SEARCH_BUTTON = "[data-search], [data-search-full]";

/**
 * Starts to load the search dialog when the reader points at or focuses a search button, so the
 * dialog usually opens without a wait.
 */
function useSearchWarmUp(): void {
  useEffect(() => {
    const listeners = new AbortController();
    const warmUp = (event: Event): void => {
      if (!(event.target instanceof Element) || !event.target.closest(SEARCH_BUTTON)) return;
      listeners.abort();
      void loadSearchDialog();
    };
    document.addEventListener("pointerover", warmUp, { passive: true, signal: listeners.signal });
    document.addEventListener("focusin", warmUp, { signal: listeners.signal });
    return () => listeners.abort();
  }, []);
}

/**
 * Marks the page root with `data-hydrated` when the page responds to input, so tests and styles
 * can wait for it. A search tap before that moment opens search now.
 */
function HydrationSignal() {
  const { setOpenSearch } = useSearchContext();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.hydrated = "";
    if (root.hasAttribute(SEARCH_TAP)) {
      root.removeAttribute(SEARCH_TAP);
      setOpenSearch(true);
    }
  }, [setOpenSearch]);
  return null;
}

/**
 * Fumadocs stores a theme in local storage, so its theme provider stays off. The appearance
 * provider keeps the selection in memory for the visit. Search renders no dialog until the reader
 * opens it, so the page loads the search code only on demand. The links of Fumadocs load their page
 * when the reader points at them.
 */
export function Provider({ children }: { children: ReactNode }) {
  useSearchWarmUp();
  return (
    <AppearanceProvider>
      <RootProvider
        theme={{ enabled: false }}
        search={{ SearchDialog: DocsSearchDialog, preload: false }}
        components={{ Link: IntentLink }}
      >
        <HydrationSignal />
        {children}
      </RootProvider>
    </AppearanceProvider>
  );
}
