/** The visible area of a scrolling list, in window coordinates. */
export type ViewportBounds = { top: number; bottom: number };

/**
 * The scroll viewport of a list that holds images and isolated pages. The list sets its bounds on
 * layout and notifies on scroll, and each resource view checks its own position.
 */
export type ViewportStore = {
  bounds: () => ViewportBounds | null;
  setBounds: (bounds: ViewportBounds) => void;
  /** Tells resource views that the list scrolled. */
  notify: () => void;
  subscribe: (listener: () => void) => () => void;
};

export const createViewportStore = (): ViewportStore => {
  let current: ViewportBounds | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    bounds: () => current,
    setBounds(next) {
      if (current?.top === next.top && current.bottom === next.bottom) return;
      current = next;
      notify();
    },
    notify,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * True when a view at `top` with `height` (window coordinates) is within one viewport height of
 * the visible area. A resource then loads just before it scrolls in, and it releases one screen
 * after it scrolls out.
 */
export const isNearViewport = (top: number, height: number, bounds: ViewportBounds): boolean => {
  const margin = bounds.bottom - bounds.top;
  return top + height >= bounds.top - margin && top <= bounds.bottom + margin;
};
