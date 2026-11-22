import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createUsageRateCatalog,
  parseUsageRateCatalog,
  type StoredUsageRates,
  type UsageRateStorage,
} from "./usage-rate-catalog";

/** An excerpt of the models.dev catalog in its published shape. */
const CATALOG = {
  openai: { models: { "gpt-6.2-sol": { cost: { input: 2, output: 10, cache_read: 0.1 } } } },
};

describe("parseUsageRateCatalog", () => {
  test("rejects a catalog in another shape", () => {
    expect(() =>
      parseUsageRateCatalog(
        JSON.stringify({ openai: { models: { x: { cost: { input: "2" } } } } }),
      ),
    ).toThrow();
  });
});

describe("createUsageRateCatalog", () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
  });

  /** A catalog server that answers with `status`, and the If-None-Match header of each request. */
  const serve = (status: () => number) => {
    const etags: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        etags.push(request.headers.get("if-none-match"));
        const code = status();
        return code === 200
          ? Response.json(CATALOG, { headers: { etag: '"v2"' } })
          : new Response(null, { status: code });
      },
    });
    servers.push(server);
    return { url: `http://localhost:${server.port}/api.json`, etags };
  };

  const memoryStorage = (initial: StoredUsageRates | null) => {
    let stored = initial;
    const storage: UsageRateStorage = {
      load: () => Effect.succeed(stored),
      save: (next) => Effect.sync(() => void (stored = next)),
      touch: (fetchedAtMs) =>
        Effect.sync(() => void (stored = stored && { ...stored, fetchedAtMs })),
    };
    return { storage, stored: () => stored };
  };

  const DAY = 24 * 60 * 60 * 1000;
  const storedCopy = (fetchedAtMs: number): StoredUsageRates => ({
    fetchedAtMs,
    etag: '"v1"',
    document: JSON.stringify(CATALOG),
  });

  test("uses a stored copy from the last day without a download", async () => {
    const server = serve(() => 200);
    const { storage } = memoryStorage(storedCopy(1_000));
    const pricing = await Effect.runPromise(
      createUsageRateCatalog(storage, server.url, () => 1_000 + DAY - 1).current(),
    );
    expect(server.etags).toEqual([]);
    expect(pricing.updatedAtMs).toBe(1_000);
    expect(pricing.pricer.stepsFor("openai", "gpt-6.2-sol", null)).not.toBeNull();
  });

  test("downloads an old copy again with its ETag, and keeps an unchanged one", async () => {
    const server = serve(() => 304);
    const { storage, stored } = memoryStorage(storedCopy(1_000));
    const pricing = await Effect.runPromise(
      createUsageRateCatalog(storage, server.url, () => 1_000 + DAY).current(),
    );
    expect(server.etags).toEqual(['"v1"']);
    expect(pricing).toMatchObject({ updatedAtMs: 1_000 + DAY, failure: null });
    expect(stored()?.fetchedAtMs).toBe(1_000 + DAY);
  });

  test("stores a first download", async () => {
    const server = serve(() => 200);
    const { storage, stored } = memoryStorage(null);
    const pricing = await Effect.runPromise(
      createUsageRateCatalog(storage, server.url, () => 5_000).current(),
    );
    expect(server.etags).toEqual([null]);
    expect(pricing.updatedAtMs).toBe(5_000);
    expect(stored()).toMatchObject({ fetchedAtMs: 5_000, etag: '"v2"' });
  });

  test("names a failed download, keeps the stored rates, and tries again after five minutes", async () => {
    let status = 503;
    const server = serve(() => status);
    let now = 1_000 + DAY;
    const { storage } = memoryStorage(storedCopy(1_000));
    const catalog = createUsageRateCatalog(storage, server.url, () => now);
    const failed = await Effect.runPromise(catalog.current());
    expect(failed.updatedAtMs).toBe(1_000);
    expect(failed.failure).toBe("The server answered 503.");
    expect(failed.pricer.stepsFor("openai", "gpt-6.2-sol", null)).not.toBeNull();
    now += 60_000;
    await Effect.runPromise(catalog.current());
    expect(server.etags).toHaveLength(1);
    status = 200;
    now += 5 * 60_000;
    const recovered = await Effect.runPromise(catalog.current());
    expect(server.etags).toHaveLength(2);
    expect(recovered).toMatchObject({ updatedAtMs: now, failure: null });
  });

  test("prices nothing when no copy and no download exist", async () => {
    const server = serve(() => 500);
    const { storage } = memoryStorage(null);
    const pricing = await Effect.runPromise(
      createUsageRateCatalog(storage, server.url, () => 1).current(),
    );
    expect(pricing.updatedAtMs).toBeNull();
    expect(pricing.failure).toBe("The server answered 500.");
    expect(pricing.pricer.stepsFor("openai", "gpt-6.2-sol", null)).toBeNull();
  });
});
