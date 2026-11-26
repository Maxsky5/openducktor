/** The synchronous key and value subset of the Web Storage API that client state uses. */
export type ClientStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Storage that lives only as long as its connection. Remote hosts use it for drafts. */
export const createMemoryClientStorage = (): ClientStorage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

/**
 * A view of `base` that keeps its keys under `prefix`, so several owners can share one device
 * storage. It lists only its own keys. It reads the key list again after each of its own writes and
 * at each `length` read.
 */
export const createPrefixedClientStorage = (base: ClientStorage, prefix: string): ClientStorage => {
  let keys: string[] | null = null;
  const readKeys = (): string[] => {
    const own: string[] = [];
    for (let index = 0, count = base.length; index < count; index += 1) {
      const key = base.key(index);
      if (key?.startsWith(prefix)) own.push(key.slice(prefix.length));
    }
    keys = own;
    return own;
  };
  return {
    get length() {
      return readKeys().length;
    },
    key: (index) => (keys ?? readKeys())[index] ?? null,
    getItem: (key) => base.getItem(prefix + key),
    setItem: (key, value) => {
      base.setItem(prefix + key, value);
      keys = null;
    },
    removeItem: (key) => {
      base.removeItem(prefix + key);
      keys = null;
    },
  };
};
