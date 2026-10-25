import { describe, expect, test } from "bun:test";
import { clearHostContentCaches, contentHash, createHostContentCache, LruCache } from "./lru-cache";

describe("host content caches", () => {
  test("a host switch clears every host content cache and keeps other caches", () => {
    const markdown = createHostContentCache<string, string>(4);
    const code = createHostContentCache<string, string>(4);
    const local = new LruCache<string, string>(4);
    markdown.set("message-1", "Host text");
    code.set("ts:hash", "const a = 1;");
    local.set("key", "value");

    clearHostContentCaches();

    expect(markdown.size).toBe(0);
    expect(code.size).toBe(0);
    expect(local.get("key")).toBe("value");
  });
});

describe("LruCache", () => {
  test("removes the least recently used entry past its limit", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  test("replaces an entry without growing", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  test("rejects a limit below one", () => {
    expect(() => new LruCache<string, number>(0)).toThrow("needs a limit of 1 or more");
  });
});

describe("contentHash", () => {
  test("gives equal texts the same hash and different texts different hashes", () => {
    expect(contentHash("const a = 1;")).toBe(contentHash("const a = 1;"));
    expect(contentHash("const a = 1;")).not.toBe(contentHash("const a = 2;"));
    expect(contentHash("")).not.toBe(contentHash(" "));
  });
});
