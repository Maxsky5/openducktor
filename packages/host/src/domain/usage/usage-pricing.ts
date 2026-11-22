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
export type UsageModelRates = {
  base: readonly UsageRateStep[];
  tiers: Readonly<Record<string, readonly UsageRateStep[]>>;
};

/** The published rates of each provider and model, keyed as the runtimes record them. */
export type UsageRateCatalog = Readonly<Record<string, Readonly<Record<string, UsageModelRates>>>>;

/** Anthropic snapshots end in `-YYYYMMDD`; OpenAI snapshots end in `-YYYY-MM-DD`. */
const DATE_SUFFIX = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** Service tiers that the base rates price. A request without a tier also uses them. */
const STANDARD_TIERS = new Set(["standard", "default"]);

export type UsagePricer = {
  /** The rate steps of a request, or null when the catalog has no rate for it. */
  stepsFor(provider: string, model: string, tier: string | null): readonly UsageRateStep[] | null;
};

/**
 * Matches the recorded provider and model exactly, or the model without its snapshot date
 * suffix. It never guesses a rate by similarity. A tier other than the standard tiers needs its
 * own rates.
 */
export const createUsagePricer = (catalog: UsageRateCatalog): UsagePricer => ({
  stepsFor: (provider, model, tier) => {
    const models = catalog[provider];
    const rates = models?.[model] ?? models?.[model.replace(DATE_SUFFIX, "")];
    if (!rates) return null;
    if (tier === null || STANDARD_TIERS.has(tier)) return rates.base;
    return rates.tiers[tier] ?? null;
  },
});
