import { Effect } from "effect";
import { z } from "zod";
import {
  createUsagePricer,
  type UsageModelRates,
  type UsagePricer,
  type UsageRateCatalog,
  type UsageRates,
  type UsageRateStep,
} from "../../domain/usage/usage-pricing";
import { errorMessage, type HostOperationErrorAggregate } from "../../effect/host-errors";

/** The public catalog of model rates that OpenCode also uses. Its provider IDs match the records. */
export const USAGE_RATES_URL = "https://models.dev/api.json";
export const USAGE_RATES_SOURCE = "models.dev";

/** A downloaded catalog stays current for a day. */
const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After a failed download, reads use what they have for this long before they try again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

/** The catalog as the index keeps it: the JSON text of the last download. */
export type StoredUsageRates = { fetchedAtMs: number; etag: string | null; document: string };

/** Reads and writes the stored catalog. The usage index store implements it. */
export type UsageRateStorage = {
  load: () => Effect.Effect<StoredUsageRates | null, HostOperationErrorAggregate>;
  save: (rates: StoredUsageRates) => Effect.Effect<void, HostOperationErrorAggregate>;
  /** Marks the stored copy as current again. */
  touch: (fetchedAtMs: number) => Effect.Effect<void, HostOperationErrorAggregate>;
};

/** The rates of a read, and where they came from. */
export type UsagePricing = {
  pricer: UsagePricer;
  /** When the host downloaded the rates, or null without rates. */
  updatedAtMs: number | null;
  /** Why the rates are missing or out of date, with the action that fixes it. */
  issue: string | null;
};

const cost = z.object({
  input: z.number().nonnegative().optional(),
  output: z.number().nonnegative().optional(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional(),
});
type Cost = z.output<typeof cost>;

const modelSchema = z.object({
  cost: cost
    .extend({
      tiers: z
        .array(cost.extend({ tier: z.object({ type: z.string(), size: z.number().optional() }) }))
        .optional(),
      context_over_200k: cost.optional(),
    })
    .optional(),
  experimental: z
    .object({
      modes: z
        .record(
          z.string(),
          z.object({
            cost: cost.optional(),
            // The request body of the mode: OpenAI `service_tier` or Anthropic `speed`.
            provider: z
              .object({
                body: z
                  .object({
                    service_tier: z.string().optional().catch(undefined),
                    speed: z.string().optional().catch(undefined),
                  })
                  .optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const catalogSchema = z.record(
  z.string(),
  z.object({ models: z.record(z.string(), modelSchema).optional() }),
);

/**
 * The rates of a catalog cost over the rates it refines. A missing cache rate means that the
 * provider bills cache traffic as input. The catalog lists only the 5-minute cache write rate;
 * a 1-hour cache write costs twice the input rate, as Anthropic publishes. Only Claude records
 * 1-hour cache writes.
 */
const ratesOf = (value: Cost, over: UsageRates | null): UsageRates | null => {
  const input = value.input ?? over?.input;
  const output = value.output ?? over?.output;
  if (input === undefined || output === undefined) return null;
  return {
    input,
    output,
    cacheRead: value.cache_read ?? over?.cacheRead ?? input,
    cacheWrite5m: value.cache_write ?? over?.cacheWrite5m ?? input,
    cacheWrite1h: 2 * input,
  };
};

/** The base steps: the base rates, then each prompt size tier above them. */
const baseSteps = (value: NonNullable<z.output<typeof modelSchema>["cost"]>) => {
  const base = ratesOf(value, null);
  if (!base) return null;
  const steps: UsageRateStep[] = [{ minPrompt: 0, rates: base }];
  const tiers = value.tiers?.filter((tier) => tier.tier.type === "context" && tier.tier.size);
  const larger = tiers?.length
    ? tiers.map((tier) => ({ size: tier.tier.size ?? 0, cost: tier }))
    : value.context_over_200k
      ? [{ size: 200_000, cost: value.context_over_200k }]
      : [];
  for (const { size, cost: tier } of larger.toSorted((a, b) => a.size - b.size)) {
    const rates = ratesOf(tier, base);
    if (rates) steps.push({ minPrompt: size, rates });
  }
  return steps;
};

/**
 * Turns the JSON text of a models.dev catalog into the rates of each provider and model. A mode
 * that sets a service tier, OpenAI `service_tier` or Anthropic `speed`, gives the rates of the
 * requests that record that tier. OpenCode records a request in a mode as the model
 * `<model>-<mode>`, so that ID gets the rates of the mode.
 */
export const parseUsageRateCatalog = (text: string): UsageRateCatalog => {
  const catalog: Record<string, Record<string, UsageModelRates>> = {};
  for (const [provider, entry] of Object.entries(catalogSchema.parse(JSON.parse(text)))) {
    for (const [model, info] of Object.entries(entry.models ?? {})) {
      const base = info.cost ? baseSteps(info.cost) : null;
      if (!base) continue;
      const tiers: Record<string, UsageRateStep[]> = {};
      catalog[provider] ??= {};
      for (const [name, mode] of Object.entries(info.experimental?.modes ?? {})) {
        const rates = mode.cost ? ratesOf(mode.cost, base[0]!.rates) : null;
        if (!rates) continue;
        const tier = mode.provider?.body?.service_tier ?? mode.provider?.body?.speed;
        if (tier) tiers[tier] = [{ minPrompt: 0, rates }];
        // OpenCode offers each mode as its own model, `<model>-<mode>`, and records that ID.
        catalog[provider][`${model}-${name}`] ??= { base: [{ minPrompt: 0, rates }], tiers: {} };
      }
      catalog[provider][model] = { base, tiers };
    }
  }
  return catalog;
};

/** The text of a catalog with its rates. It throws when the text is not a catalog. */
const parsedDocument = (document: string) => ({
  document,
  rates: parseUsageRateCatalog(document),
});

const EMPTY_PRICER = createUsagePricer({});

type Current = { pricer: UsagePricer; fetchedAtMs: number; etag: string | null };

/**
 * The rates of the usage reads. The host downloads the models.dev catalog when its stored copy is
 * a day old, and keeps the last copy in the usage index. A failed download keeps the stored
 * rates, names the failure, and tries again after five minutes.
 */
export const createUsageRateCatalog = (
  storage: UsageRateStorage,
  url: string,
  now: () => number = Date.now,
) => {
  let current: Current | null = null;
  let loaded = false;
  let failure: { atMs: number; message: string } | null = null;

  const pricing = (): UsagePricing => ({
    pricer: current?.pricer ?? EMPTY_PRICER,
    updatedAtMs: current?.fetchedAtMs ?? null,
    issue: failure
      ? `Usage could not ${current ? "update" : "load"} the API rates from ${USAGE_RATES_SOURCE}: ${failure.message} Check the network access of the host, then refresh.`
      : null,
  });

  const loadStored = Effect.gen(function* () {
    loaded = true;
    const stored = yield* storage.load();
    if (!stored) return;
    // The index is a disposable cache: a copy that does not parse downloads again.
    const rates = yield* Effect.try(() => parseUsageRateCatalog(stored.document)).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (rates)
      current = {
        pricer: createUsagePricer(rates),
        fetchedAtMs: stored.fetchedAtMs,
        etag: stored.etag,
      };
  });

  const download = (etag: string | null) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url, {
          headers: etag ? { "If-None-Match": etag } : {},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (response.status === 304) return null;
        if (!response.ok) throw new Error(`The server answered ${response.status}.`);
        return {
          etag: response.headers.get("etag"),
          ...parsedDocument(await response.text()),
        };
      },
      catch: (cause) => errorMessage(cause),
    });

  return {
    /** The rates for the next read. It downloads them first when the stored copy is old. */
    current: (): Effect.Effect<UsagePricing, HostOperationErrorAggregate> =>
      Effect.gen(function* () {
        if (!loaded) yield* loadStored;
        const atMs = now();
        if (current && atMs - current.fetchedAtMs < RATES_MAX_AGE_MS) return pricing();
        if (failure && atMs - failure.atMs < RETRY_AFTER_MS) return pricing();
        const downloaded = yield* download(current?.etag ?? null).pipe(
          Effect.match({
            onFailure: (message) => ({ failed: message }) as const,
            onSuccess: (next) => ({ next }) as const,
          }),
        );
        if ("failed" in downloaded) {
          failure = { atMs, message: downloaded.failed };
          return pricing();
        }
        failure = null;
        const { next } = downloaded;
        if (next) {
          current = { pricer: createUsagePricer(next.rates), fetchedAtMs: atMs, etag: next.etag };
          yield* storage.save({
            fetchedAtMs: atMs,
            etag: next.etag,
            document: next.document,
          });
        } else if (current) {
          // The catalog did not change since the stored copy.
          current = { ...current, fetchedAtMs: atMs };
          yield* storage.touch(atMs);
        }
        return pricing();
      }),
  };
};
