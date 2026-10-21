/** How the keyboard focus enters a page. */
export type PageFocusOptions = {
  /**
   * True when a key moved the focus, such as Tab or F6, so the page shows a focus ring. A click
   * or a loaded address moves the focus without a ring, as in a browser.
   */
  fromKeyboard: boolean;
};

/**
 * The keyboard focus targets of each browser tab: its page surface and its address bar. The page
 * surface lives in the browser layer, outside the tab view, so the two reach each other here.
 */
export const createBrowserFocusRegistry = () => {
  const pages = new Map<string, (options: PageFocusOptions) => void>();
  const addressBars = new Map<string, () => void>();

  const register = <Focus>(targets: Map<string, Focus>, tabId: string, focus: Focus) => {
    targets.set(tabId, focus);
    return (): void => {
      if (targets.get(tabId) === focus) targets.delete(tabId);
    };
  };

  return {
    registerPage: (tabId: string, focus: (options: PageFocusOptions) => void): (() => void) =>
      register(pages, tabId, focus),
    registerAddressBar: (tabId: string, focus: () => void): (() => void) =>
      register(addressBars, tabId, focus),
    /** Moves the keyboard focus into the page. Does nothing while no page surface shows. */
    focusPage: (tabId: string, options: PageFocusOptions): void => pages.get(tabId)?.(options),
    focusAddressBar: (tabId: string): void => addressBars.get(tabId)?.(),
  };
};

export type BrowserFocusRegistry = ReturnType<typeof createBrowserFocusRegistry>;
