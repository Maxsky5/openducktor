import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useLayoutEffect,
  useState,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

type NeedsYouCount = { count: number };

const NeedsYouCountContext = createContext<StoreApi<NeedsYouCount> | null>(null);

/**
 * The Needs you count of the Sessions tab badge. The session model lives in the Sessions stack,
 * so React looks for its readers only there after a live change. The tab bar reads the count
 * from this store, which keeps one object for the whole connection.
 */
export function NeedsYouCountProvider({ children }: PropsWithChildren): ReactElement {
  const [store] = useState(() => createStore<NeedsYouCount>(() => ({ count: 0 })));
  return <NeedsYouCountContext value={store}>{children}</NeedsYouCountContext>;
}

const useNeedsYouCountStore = (): StoreApi<NeedsYouCount> => {
  const store = use(NeedsYouCountContext);
  if (!store) throw new Error("The Needs you count must be read inside the tabs layout.");
  return store;
};

/** Publishes the count of the session model that the Sessions list shows. */
export const usePublishNeedsYouCount = (count: number): void => {
  const store = useNeedsYouCountStore();
  useLayoutEffect(() => {
    store.setState({ count });
  }, [count, store]);
};

export const useNeedsYouCount = (): number =>
  useStore(useNeedsYouCountStore(), (state) => state.count);
