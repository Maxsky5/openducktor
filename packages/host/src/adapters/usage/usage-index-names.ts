import { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { type IndexQueries, num, str } from "./usage-index-rows";

/** The kinds of stored names that pricing reads. */
type PricedKind = "provider" | "model" | "tier";

/**
 * The stored names of one index connection. Name IDs only grow, so a sync reads only new names,
 * also the ones that another host added.
 */
export const createUsageNameCache = ({ values, run }: IndexQueries) => {
  const ids = new Map<string, number>();
  const priced = {
    provider: new Map<number, string>(),
    model: new Map<number, string>(),
    tier: new Map<number, string>(),
  };
  let lastId = 0;

  /** Reads the names after the last known ID. */
  const sync = () =>
    Effect.gen(function* () {
      const rows = yield* values(
        "SELECT id, kind, value FROM name WHERE id > ? ORDER BY id",
        lastId,
      );
      for (const row of rows) {
        const id = num(row[0]);
        const kind = str(row[1]);
        const value = str(row[2]);
        ids.set(`${kind}\u0000${value}`, id);
        lastId = Math.max(lastId, id);
        if (kind === "provider" || kind === "model" || kind === "tier") priced[kind].set(id, value);
      }
    });

  return {
    sync,

    /** The highest stored name ID. It changes when a sync finds a new name. */
    lastId: () => lastId,

    /** The stored providers, models, or tiers by ID, in ID order. */
    entries: (kind: PricedKind): ReadonlyMap<number, string> => priced[kind],

    /** The ID of a stored string, or 0 for none. It stores a new string first. */
    idOf: (
      kind: string,
      value: string | null,
    ): Effect.Effect<number, HostOperationErrorAggregate> => {
      if (value === null) return Effect.succeed(0);
      const known = ids.get(`${kind}\u0000${value}`);
      if (known !== undefined) return Effect.succeed(known);
      return run("INSERT OR IGNORE INTO name (kind, value) VALUES (?, ?)", kind, value).pipe(
        Effect.andThen(sync()),
        Effect.map(() => ids.get(`${kind}\u0000${value}`) ?? 0),
      );
    },

    /** The ID of a known string, 0 for none, or undefined for a string that `idOf` must store. */
    cachedId: (kind: string, value: string | null): number | undefined =>
      value === null ? 0 : ids.get(`${kind}\u0000${value}`),
  };
};
