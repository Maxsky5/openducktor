import { useSyncExternalStore } from "react";

/** Heights of the elements at the screen bottom that toasts must not cover. */
const insets = new Map<symbol, number>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const bottomInset = (): number => Math.max(0, ...insets.values());

/**
 * Keeps toasts above an element that touches the screen bottom until the returned cleanup runs. It
 * has the shape of a React ref callback.
 */
export const reserveToasterInset = (element: HTMLElement | null): (() => void) | undefined => {
  // React 19 does not call a ref callback with null when the callback returns a cleanup.
  if (element === null) return;
  const key = Symbol("toaster-inset");
  const measure = (): void => {
    insets.set(key, element.offsetHeight);
    emit();
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  measure();
  return () => {
    observer.disconnect();
    insets.delete(key);
    emit();
  };
};

/** The height that toasts must leave free at the bottom of the screen. */
export const useToasterBottomInset = (): number => useSyncExternalStore(subscribe, bottomInset);
