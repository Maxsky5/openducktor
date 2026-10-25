import { createContext, use, useCallback, useMemo, useSyncExternalStore } from "react";

export type Disclosure = {
  open: boolean;
  /** True after the reader pressed the control. Only a press animates. */
  pressed: boolean;
  toggle: () => void;
};

/**
 * The reader's open and closed choices of one transcript, by part key. The list reuses row views
 * for other rows, so a choice lives here and not in the view: a part that scrolls away and back
 * keeps it.
 */
export type DisclosureStore = {
  read: (key: string) => boolean | undefined;
  choose: (key: string, open: boolean) => void;
  subscribe: (key: string, listener: () => void) => () => void;
};

export const createDisclosureStore = (): DisclosureStore => {
  const choices = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    read: (key) => choices.get(key),
    choose(key, open) {
      choices.set(key, open);
      for (const listener of Array.from(listeners.get(key) ?? [])) listener();
    },
    subscribe(key, listener) {
      const forKey = listeners.get(key) ?? new Set();
      forKey.add(listener);
      listeners.set(key, forKey);
      return () => {
        forKey.delete(listener);
        if (forKey.size === 0) listeners.delete(key);
      };
    },
  };
};

const DisclosureStoreContext = createContext<DisclosureStore | null>(null);

export const DisclosureStoreProvider = DisclosureStoreContext;

/**
 * Measures the list row again. A row of the transcript list gives it, so a part that opens or
 * closes gets its new place in the same frame.
 */
const RowLayoutContext = createContext<(() => void) | null>(null);

export const RowLayoutProvider = RowLayoutContext;

/**
 * The open state of a part that the reader opens with a press, as a desktop `<details>`. The part
 * follows `defaultOpen` until the reader presses it, so a part that gets content later, such as a
 * file edit whose diff arrives when the call ends, opens as it does after a reload. Each `key`
 * has its own choice. In the transcript list, a press measures the row again in the same frame.
 */
export const useDisclosure = (defaultOpen: boolean, key: string): Disclosure => {
  const store = use(DisclosureStoreContext);
  if (!store) throw new Error("A disclosure needs the transcript disclosure store.");
  const layoutRow = use(RowLayoutContext);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [key, store],
  );
  const read = useCallback(() => store.read(key), [key, store]);
  const choice = useSyncExternalStore(subscribe, read, read);
  const open = choice ?? defaultOpen;
  const toggle = useCallback(() => {
    store.choose(key, !open);
    layoutRow?.();
  }, [key, layoutRow, open, store]);
  return useMemo(() => ({ open, pressed: choice !== undefined, toggle }), [choice, open, toggle]);
};
