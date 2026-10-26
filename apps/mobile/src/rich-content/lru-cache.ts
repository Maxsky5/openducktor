/**
 * A bounded cache. A read moves the entry to the newest place. A write past the limit removes
 * the oldest entry, so module-level caches cannot grow without bound. Values must not be
 * `undefined`, because `get` returns `undefined` for a missing key.
 */
export class LruCache<Key, Value> {
  private readonly entries = new Map<Key, Value>();

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`An LRU cache needs a limit of 1 or more, not ${limit}.`);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: Key): Value | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  set(key: Key, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size <= this.limit) return;
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}

const hostContentCaches = new Set<{ clear(): void }>();

/**
 * A cache of values that come from host content, such as parsed Markdown or highlighted code. A
 * host switch clears it with `clearHostContentCaches`, so no text of the old host stays in memory.
 */
export const createHostContentCache = <Key, Value>(limit: number): LruCache<Key, Value> => {
  const cache = new LruCache<Key, Value>(limit);
  hostContentCaches.add(cache);
  return cache;
};

export const clearHostContentCaches = (): void => {
  for (const cache of hostContentCaches) cache.clear();
};

/** A fast 53-bit string hash (cyrb53) with the text length, for cache keys of long texts. */
export const contentHash = (text: string): string => {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & second) + (first >>> 0);
  return `${hash.toString(36)}.${text.length.toString(36)}`;
};
