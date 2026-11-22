import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { UsagePricer } from "../../domain/usage/usage-pricing";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { createUsageNameCache } from "./usage-index-names";
import { type IndexQueries, placeholderRows } from "./usage-index-rows";

/** The columns of a price insert, in the order of its parameters. */
const PRICE_COLUMNS = [
  "provider_id",
  "model_id",
  "tier_id",
  "min_prompt",
  "input",
  "cache_read",
  "cache_write_5m",
  "cache_write_1h",
  "output",
];
const COLUMNS = PRICE_COLUMNS.length;
/** Rows per insert, within the SQL parameter limit. */
const BATCH = 100;

/**
 * The temporary price table of one connection: the rate steps of every stored provider, model,
 * and tier. Tier ID 0 is a request without a recorded tier.
 */
export const createUsagePriceTable = (
  { run }: Pick<IndexQueries, "run">,
  names: ReturnType<typeof createUsageNameCache>,
) => {
  let pricedWith: UsagePricer | null = null;
  let pricedThroughId = -1;
  let digest = "";

  return {
    /**
     * Prices the stored names with `pricer`, and returns a digest of the rates. The digest stays
     * the same while the names and their rates stay the same, so the rollup reprices only when a
     * rate changes.
     */
    update: (pricer: UsagePricer): Effect.Effect<string, HostOperationErrorAggregate> =>
      Effect.gen(function* () {
        if (pricer === pricedWith && names.lastId() === pricedThroughId) return digest;
        const rows: number[] = [];
        const tiers: [number, string | null][] = [[0, null], ...names.entries("tier")];
        for (const [providerId, provider] of names.entries("provider"))
          for (const [modelId, model] of names.entries("model"))
            for (const [tierId, tier] of tiers)
              for (const { minPrompt, rates } of pricer.stepsFor(provider, model, tier) ?? [])
                rows.push(
                  providerId,
                  modelId,
                  tierId,
                  minPrompt,
                  rates.input,
                  rates.cacheRead,
                  rates.cacheWrite5m,
                  rates.cacheWrite1h,
                  rates.output,
                );
        yield* run("DELETE FROM price");
        for (let start = 0; start < rows.length; start += BATCH * COLUMNS) {
          const batch = rows.slice(start, start + BATCH * COLUMNS);
          yield* run(
            `INSERT INTO price (${PRICE_COLUMNS.join(", ")}) VALUES ${placeholderRows(batch.length / COLUMNS, COLUMNS)}`,
            ...batch,
          );
        }
        pricedWith = pricer;
        pricedThroughId = names.lastId();
        digest = createHash("sha256").update(rows.join(",")).digest("hex");
        return digest;
      }),
  };
};
