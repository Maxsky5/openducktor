import { toContextStorageKey } from "./agent-studio-navigation";
import { toTabsStorageKey } from "./agents-page-selection";
import { toPersistedTaskTabs } from "./agents-page-session-tabs";

export type TestStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "clear" | "key"
> & {
  readonly length: number;
};

export const createMemoryStorage = (): TestStorageLike => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

export const withMockedLocalStorage = async <T>(
  storage: TestStorageLike,
  run: () => Promise<T> | T,
): Promise<T> => {
  const originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  }
};

export const seedRepoNavigationContexts = (
  storage: Pick<Storage, "setItem">,
  contexts: Record<string, Record<string, unknown>>,
): void => {
  for (const [repoPath, context] of Object.entries(contexts)) {
    storage.setItem(toContextStorageKey(repoPath), JSON.stringify(context));
  }
};

export const seedRepoTaskTabs = (
  storage: Pick<Storage, "setItem">,
  tabsByRepo: Record<string, { tabs: string[]; activeTaskId: string | null }>,
): void => {
  for (const [repoPath, persistedTabs] of Object.entries(tabsByRepo)) {
    storage.setItem(toTabsStorageKey(repoPath), toPersistedTaskTabs(persistedTabs));
  }
};
