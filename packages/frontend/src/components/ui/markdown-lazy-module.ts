import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";

export type LazyModuleState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "failed"; message: string };

/**
 * A module that loads the first time that a view needs it. Each view reads the same state, so a
 * view that mounts after the load uses the module at once.
 */
export const createLazyModule = <T>(load: () => Promise<T>) => {
  let state: LazyModuleState<T> = { status: "loading" };
  let started = false;
  const listeners = new Set<() => void>();
  const settle = (next: LazyModuleState<T>): void => {
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };
  const start = (): void => {
    if (started) return;
    started = true;
    load().then(
      (value) => settle({ status: "ready", value }),
      (cause: unknown) => settle({ status: "failed", message: errorMessage(cause) }),
    );
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getState = (): LazyModuleState<T> => state;
  /** The state of the module. The module starts to load when `needed` is true. */
  const useModule = (needed: boolean): LazyModuleState<T> => {
    useEffect(() => {
      if (needed) start();
    }, [needed]);
    return useSyncExternalStore(subscribe, getState, getState);
  };
  return { useModule };
};
