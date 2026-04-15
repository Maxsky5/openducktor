import {
  toContextStorageKey,
  toLegacyRepoPathContextStorageKey,
  toLegacyRepoPathTabsStorageKey,
} from "./agent-studio-navigation";
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

export const seedWorkspaceNavigationContexts = (
  storage: Pick<Storage, "setItem">,
  contexts: Record<string, Record<string, unknown>>,
): void => {
  for (const [workspaceId, context] of Object.entries(contexts)) {
    storage.setItem(toContextStorageKey(workspaceId), JSON.stringify(context));
  }
};

export const seedLegacyRepoNavigationContexts = (
  storage: Pick<Storage, "setItem">,
  contexts: Record<string, Record<string, unknown>>,
): void => {
  for (const [repoPath, context] of Object.entries(contexts)) {
    storage.setItem(toLegacyRepoPathContextStorageKey(repoPath), JSON.stringify(context));
  }
};

export const seedWorkspaceTaskTabs = (
  storage: Pick<Storage, "setItem">,
  tabsByWorkspace: Record<string, { tabs: string[]; activeTaskId: string | null }>,
): void => {
  for (const [workspaceId, persistedTabs] of Object.entries(tabsByWorkspace)) {
    storage.setItem(toTabsStorageKey(workspaceId), toPersistedTaskTabs(persistedTabs));
  }
};

export const seedLegacyRepoTaskTabs = (
  storage: Pick<Storage, "setItem">,
  tabsByRepo: Record<string, { tabs: string[]; activeTaskId: string | null }>,
): void => {
  for (const [repoPath, persistedTabs] of Object.entries(tabsByRepo)) {
    storage.setItem(toLegacyRepoPathTabsStorageKey(repoPath), toPersistedTaskTabs(persistedTabs));
  }
};
