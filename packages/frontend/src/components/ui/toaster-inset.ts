import { useSyncExternalStore } from "react";

/** Heights of the elements that toasts must not cover, such as an open sheet footer. */
const heights = new Map<symbol, number>();
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

const bottomInset = (): number => Math.max(0, ...heights.values());

/** Keeps toasts above an element at the bottom of the screen until the returned cleanup runs. */
export const reserveToasterInset = (element: HTMLElement): (() => void) => {
  const key = Symbol("toaster-inset");
  const measure = (): void => {
    if (heights.get(key) === element.offsetHeight) return;
    heights.set(key, element.offsetHeight);
    emit();
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  measure();
  return () => {
    observer.disconnect();
    heights.delete(key);
    emit();
  };
};

/** The height that toasts must leave free at the bottom of the screen. */
export const useToasterBottomInset = (): number => useSyncExternalStore(subscribe, bottomInset);
