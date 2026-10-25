import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";

/** The synchronous key and value store of one device scope. An MMKV instance satisfies it. */
export type DeviceKeyValueStore = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  getAllKeys(): string[];
};

/**
 * Gives frontend-core the storage of one saved host. `length` and `key()` list only that store.
 * The key list is cached between writes, because draft loading reads it in a loop.
 */
export const createDeviceClientStorage = (store: DeviceKeyValueStore): ClientStorage => {
  let keys: string[] | null = null;
  const currentKeys = () => {
    keys ??= store.getAllKeys().sort();
    return keys;
  };
  return {
    get length() {
      return currentKeys().length;
    },
    key: (index) => currentKeys()[index] ?? null,
    getItem: (key) => store.getString(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
      keys = null;
    },
    removeItem: (key) => {
      store.remove(key);
      keys = null;
    },
  };
};
