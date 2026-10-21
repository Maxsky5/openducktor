/** Where a surface must show: the panel slot element of a page or of docked DevTools. */
export type BrowserSlot = {
  readonly element: HTMLElement;
  /** False while the tab is not the selected tab of a shown panel. */
  readonly visible: boolean;
};

/**
 * Values by surface key that tell their listeners about each change. Panels register the slots of
 * pages and docked DevTools, and the browser layer places the surfaces over them, so a page
 * never moves in the DOM when its tab moves or hides. Each surface frame registers its overlay
 * element, so a tab view can draw prompts, the picker, and markers above the page with a portal.
 */
export const createBrowserSurfaceRegistry = <Value>() => {
  const values = new Map<string, Value>();
  const listeners = new Set<() => void>();
  let version = 0;

  const changed = (): void => {
    version += 1;
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    /** Registers the value of a surface key and returns its removal. */
    register(key: string, value: Value): () => void {
      values.set(key, value);
      changed();
      return () => {
        if (values.get(key) === value) {
          values.delete(key);
          changed();
        }
      };
    },
    get: (key: string): Value | undefined => values.get(key),
    keys: (): string[] => Array.from(values.keys()),
    version: (): number => version,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export type BrowserSurfaceRegistry<Value> = ReturnType<typeof createBrowserSurfaceRegistry<Value>>;

export const browserSurfaceKey = (tabId: string): string => `browser:${tabId}`;
export const devToolsSurfaceKey = (tabId: string): string => `devtools:${tabId}`;
