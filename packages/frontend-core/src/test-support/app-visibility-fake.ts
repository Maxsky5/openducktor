import type { AppVisibility } from "../platform/app-visibility";

/** An app that stays visible and never reports a change. */
export const VISIBLE_APP: AppVisibility = { isHidden: () => false, subscribe: () => () => {} };

/** An app visibility that a test hides and shows. */
export const createAppVisibilityFake = (): AppVisibility & { setHidden(hidden: boolean): void } => {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => hidden,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    setHidden(next) {
      hidden = next;
      for (const listener of Array.from(listeners)) listener();
    },
  };
};
