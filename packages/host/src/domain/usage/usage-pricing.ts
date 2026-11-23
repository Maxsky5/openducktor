/** USD per million tokens. */
export type UsageRates = {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
};

/** Rates that apply to a request whose prompt is above `minPrompt` tokens; 0 for the base rates. */
export type UsageRateStep = { minPrompt: number; rates: UsageRates };

/** The rates of one model: the base steps, and the steps of each service tier with its own rates. */
type UsageModelRates = {
  base: readonly UsageRateStep[];
  tiers: Readonly<Record<string, readonly UsageRateStep[]>>;
};

/** The published rates of each provider and model, keyed as the runtimes record them. */
export type UsageRateCatalog = Readonly<Record<string, Readonly<Record<string, UsageModelRates>>>>;

/** A cost of the models.dev catalog, in USD per million tokens. */
type UsageCatalogCost = {
  input?: number | undefined;
  output?: number | undefined;
  cache_read?: number | undefined;
  cache_write?: number | undefined;
};

/** A model of the models.dev catalog: its costs and the modes that change them. */
type UsageCatalogModel = {
  cost?:
    | (UsageCatalogCost & {
        tiers?:
          | (UsageCatalogCost & { tier: { type: string; size?: number | undefined } })[]
          | undefined;
        context_over_200k?: UsageCatalogCost | undefined;
      })
    | undefined;
  experimental?:
    | {
        modes?:
          | Record<
              string,
              {
                cost?: UsageCatalogCost | undefined;
                /** The request body of the mode: OpenAI `service_tier` or Anthropic `speed`. */
                provider?:
                  | {
                      body?:
                        | { service_tier?: string | undefined; speed?: string | undefined }
                        | undefined;
                    }
                  | undefined;
              }
            >
          | undefined;
      }
    | undefined;
};

/** The models.dev catalog: the models of each provider. */
export type UsageCatalog = Record<
  string,
  { models?: Record<string, UsageCatalogModel> | undefined }
>;

/**
 * The rates of a catalog cost over the rates it refines. A missing cache rate means that the
 * provider bills cache traffic as input. The catalog lists only the 5-minute cache write rate;
 * a 1-hour cache write costs twice the input rate, as Anthropic publishes. Only Claude records
 * 1-hour cache writes.
 */
const ratesOf = (value: UsageCatalogCost, over: UsageRates | null): UsageRates | null => {
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
const baseSteps = (value: NonNullable<UsageCatalogModel["cost"]>): UsageRateStep[] | null => {
  const base = ratesOf(value, null);
  if (!base) return null;
  const steps: UsageRateStep[] = [{ minPrompt: 0, rates: base }];
  const tiers = value.tiers?.filter((tier) => tier.tier.type === "context" && tier.tier.size);
  const larger = tiers?.length
    ? tiers.map((tier) => ({ size: tier.tier.size ?? 0, cost: tier }))
    : value.context_over_200k
      ? [{ size: 200_000, cost: value.context_over_200k }]
      : [];
  for (const { size, cost } of larger.toSorted((a, b) => a.size - b.size)) {
    const rates = ratesOf(cost, base);
    if (rates) steps.push({ minPrompt: size, rates });
  }
  return steps;
};

/**
 * The rates of each provider and model of a models.dev catalog. A mode that sets a service
 * tier, OpenAI `service_tier` or Anthropic `speed`, gives the rates of the requests that record
 * that tier. OpenCode records a request in a mode as the model `<model>-<mode>`, so that ID gets
 * the rates of the mode.
 */
export const usageRateCatalogOf = (catalog: UsageCatalog) => {
  const result: Record<string, Record<string, UsageModelRates>> = {};
  for (const [provider, entry] of Object.entries(catalog)) {
    for (const [model, info] of Object.entries(entry.models ?? {})) {
      const base = info.cost ? baseSteps(info.cost) : null;
      const baseRates = base?.[0]?.rates;
      if (!base || !baseRates) continue;
      const models = (result[provider] ??= {});
      const tiers: Record<string, UsageRateStep[]> = {};
      for (const [name, mode] of Object.entries(info.experimental?.modes ?? {})) {
        const rates = mode.cost ? ratesOf(mode.cost, baseRates) : null;
        if (!rates) continue;
        const tier = mode.provider?.body?.service_tier ?? mode.provider?.body?.speed;
        if (tier) tiers[tier] = [{ minPrompt: 0, rates }];
        models[`${model}-${name}`] ??= { base: [{ minPrompt: 0, rates }], tiers: {} };
      }
      models[model] = { base, tiers };
    }
  }
  return result;
};

/** Anthropic snapshots end in `-YYYYMMDD`; OpenAI snapshots end in `-YYYY-MM-DD`. */
const DATE_SUFFIX = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** Service tiers that the base rates price. A request without a tier also uses them. */
const STANDARD_TIERS = new Set(["standard", "default"]);

export type UsagePricer = {
  /** The rate steps of a request, or null when the catalog has no rate for it. */
  stepsFor(provider: string, model: string, tier: string | null): readonly UsageRateStep[] | null;
  /**
   * The rate steps of a model ID that can end in variants that the catalog does not list, such as
   * a thinking level: the rates of the ID, or of its longest prefix that the catalog lists.
   */
  stepsForVariant(
    provider: string,
    model: string,
    tier: string | null,
  ): readonly UsageRateStep[] | null;
};

/**
 * Matches the recorded provider and model exactly, or the model without its snapshot date
 * suffix. Only a runtime that records variant IDs uses the longest listed prefix. A tier other
 * than the standard tiers needs its own rates.
 */
export const createUsagePricer = (catalog: UsageRateCatalog): UsagePricer => {
  const stepsFor: UsagePricer["stepsFor"] = (provider, model, tier) => {
    const models = catalog[provider];
    const rates = models?.[model] ?? models?.[model.replace(DATE_SUFFIX, "")];
    if (!rates) return null;
    if (tier === null || STANDARD_TIERS.has(tier)) return rates.base;
    return rates.tiers[tier] ?? null;
  };
  return {
    stepsFor,
    stepsForVariant: (provider, model, tier) => {
      for (let id = model; ; id = id.slice(0, id.lastIndexOf("-"))) {
        const steps = stepsFor(provider, id, tier);
        if (steps || !id.includes("-")) return steps;
      }
    },
  };
};
