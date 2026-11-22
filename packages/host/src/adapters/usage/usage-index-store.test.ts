import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { USAGE_FIRST_DATE, USAGE_LAST_DATE } from "@openducktor/contracts";
import { createUsageCalendar, usagePeriods } from "../../domain/usage/usage-calendar";
import { createUsagePricer, type UsagePricer } from "../../domain/usage/usage-pricing";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import { removeTestDirectory } from "../../test-support/temp-directory";
import type { UsageIndexSnapshot, UsageSnapshotScope } from "./usage-index-snapshot";
import type { UsageSourceUpdate } from "./usage-index-sources";
import { createUsageIndexStore, type UsageIndexStore } from "./usage-index-store";

let directory = "";
let store: UsageIndexStore;
const utc = createUsageCalendar("UTC");

const opusRates = { input: 4, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8, output: 20 };
const pricer = createUsagePricer({
  anthropic: {
    "claude-opus-5-5": {
      base: [
        { minPrompt: 0, rates: opusRates },
        { minPrompt: 2_000_000, rates: { ...opusRates, input: 8 } },
      ],
      tiers: { fast: [{ minPrompt: 0, rates: { ...opusRates, input: 24 } }] },
    },
  },
});

const unit = (overrides: Partial<UsageUnit> = {}): UsageUnit => ({
  identity: "msg_1:req_1",
  occurredAtMs: Date.parse("2026-11-04T10:00:00Z"),
  session: "root",
  provider: "anthropic",
  model: "claude-opus-5-5",
  project: "/repo",
  serviceTier: "standard",
  tokens: { input: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 10 },
  ...overrides,
});

const source = (sourcePath: string, units: UsageUnit[], mode: "replace" | "append" = "replace") =>
  ({
    runtime: "claude",
    path: sourcePath,
    fingerprint: { size: 1, modifiedAtMs: 1, fileId: "1:1" },
    resume: null,
    parserState: null,
    issue: null,
    mode,
    units,
  }) satisfies UsageSourceUpdate;

const indexPath = () => path.join(directory, "usage-index.sqlite");

/** One read that commits the sources. */
const write = (...updates: UsageSourceUpdate[]) =>
  Effect.runPromise(
    store.read({
      calendar: utc,
      pricer,
      sync: (writer) => Effect.forEach(updates, writer.applySource, { discard: true }),
      report: () => Effect.void,
    }),
  );

/** One read without source changes. */
const snapshotOf = <A, E>(
  read: (snapshot: UsageIndexSnapshot) => Effect.Effect<A, E>,
  calendar = utc,
  rates = pricer,
) =>
  Effect.runPromise(store.read({ calendar, pricer: rates, sync: () => Effect.void, report: read }));

/** Sums the scope in one period, with each recorded folder as its own project group. */
const aggregateOf = (snapshot: UsageIndexSnapshot, scope: UsageSnapshotScope) =>
  snapshot.projectFolders(scope).pipe(
    Effect.flatMap((folders) =>
      snapshot.aggregate({
        ...scope,
        periods: [{ start: scope.start, end: scope.end }],
        projectGroups: folders.map(({ projectId, folder }) => ({
          projectId,
          group: folder ?? "unknown",
        })),
      }),
    ),
  );

/** The cost of November after a read with other rates. */
const costWith = async (rates: UsagePricer) => {
  const result = await snapshotOf(
    (snapshot) =>
      aggregateOf(snapshot, { start: "2026-11-01", end: "2026-11-30", runtimes: ["claude"] }),
    utc,
    rates,
  );
  return result.byRuntime[0]?.costUsd;
};

const report = (calendar = utc, start = "2026-11-01", end = "2026-11-30") =>
  snapshotOf((snapshot) => aggregateOf(snapshot, { start, end, runtimes: ["claude"] }), calendar);

const issues = () => snapshotOf((snapshot) => snapshot.issues());

const sources = (target = store) =>
  Effect.runPromise(
    target.read({
      calendar: utc,
      pricer,
      sync: (writer) => writer.sources(),
      report: (_, rows) => Effect.succeed(rows),
    }),
  );

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "odt-usage-index-"));
  store = createUsageIndexStore(indexPath());
});

afterEach(async () => {
  await Effect.runPromise(store.close());
  await removeTestDirectory(directory);
});

describe("usage index store", () => {
  test("counts the tokens of copies once, with the largest value of each field", async () => {
    const copy = unit({
      tokens: { input: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 500 },
    });
    await write(source("/p/root.jsonl", [unit()]), source("/p/root/subagents/agent.jsonl", [copy]));
    const { byRuntime } = await report();
    expect(byRuntime).toEqual([
      {
        runtime: "claude",
        input: 1_000_000,
        cacheRead: 0,
        cacheWrite: 0,
        output: 500,
        unmeasured: 0,
        unpricedTokens: 0,
        costUsd: 4.01,
        sessions: 1,
      },
    ]);
  });

  test("counts a copy in another session as activity of that session", async () => {
    await write(source("/p/a.jsonl", [unit()]));
    await write(source("/p/b.jsonl", [unit({ session: "resumed" })]));
    const [row] = (await report()).byRuntime;
    expect([row?.sessions, row?.input]).toEqual([2, 1_000_000]);
  });

  test("counts fork copies in one database for each of their sessions", async () => {
    await write(source("/p/opencode.db", [unit(), unit({ session: "fork" })]));
    const [row] = (await report()).byRuntime;
    expect([row?.sessions, row?.input]).toEqual([2, 1_000_000]);
  });

  test("counts an unmeasured and a measured copy of one response as one measured request", async () => {
    // A Codex compaction and its usage record share one response ID in one rollout.
    await write(source("/p/rollout.jsonl", [unit({ tokens: null }), unit()]));
    const [row] = (await report()).byRuntime;
    expect([row?.unmeasured, row?.input, row?.sessions]).toEqual([0, 1_000_000, 1]);
  });

  test("keeps malformed records of earlier bytes after an appended read", async () => {
    const malformed = { code: "malformed_records" as const, firstAtMs: 10, lastAtMs: 20 };
    await write({ ...source("/p/a.jsonl", []), issue: malformed });
    await write(source("/p/a.jsonl", [unit()], "append"));
    expect(await issues()).toEqual([{ runtime: "claude", scope: "source", ...malformed }]);
    await write(source("/p/a.jsonl", [unit()]));
    expect(await issues()).toEqual([]);
  });

  test("leaves usage without a rate or a token count unpriced", async () => {
    await write(
      source("/p/a.jsonl", [
        unit({ identity: "x", model: "unknown-model" }),
        unit({ identity: "y", tokens: null }),
      ]),
    );
    const [row] = (await report()).byRuntime;
    expect([row?.unpricedTokens, row?.unmeasured, row?.costUsd]).toEqual([1_000_010, 1, 0]);
  });

  test("prices a request by its service tier and by the rate step of its prompt", async () => {
    await write(
      source("/p/a.jsonl", [
        unit({ identity: "fast", serviceTier: "fast" }),
        unit({
          identity: "long",
          tokens: { input: 3_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 },
        }),
        unit({ identity: "priority", serviceTier: "priority" }),
      ]),
    );
    const [row] = (await report()).byRuntime;
    // 1M fast input at $24, 3M input above the 2M step at $8, and no rate for priority.
    expect(row?.costUsd).toBeCloseTo(24.0002 + 24, 6);
    expect(row?.unpricedTokens).toBe(1_000_010);
  });

  test("builds a full rollup in month batches and reports its share", async () => {
    const shares: number[] = [];
    const days = Array.from({ length: 40 }, (_, day) =>
      unit({ identity: `d${day}`, occurredAtMs: Date.UTC(2026, 9, 1 + day, 12) }),
    );
    await Effect.runPromise(
      store.read({
        calendar: utc,
        pricer,
        sync: (writer) => writer.applySource(source("/p/a.jsonl", days)),
        report: () => Effect.void,
        onRollup: (share) => shares.push(share),
      }),
    );
    expect(shares).toEqual([31 / 40, 1]);
    const result = await report(utc, "2026-10-01", "2026-11-30");
    expect(result.byRuntime[0]?.sessions).toBe(1);
  });

  test("prices the rollup again when a rate changes", async () => {
    await write(source("/p/a.jsonl", [unit()]));
    expect((await report()).byRuntime[0]?.costUsd).toBeCloseTo(4.0002, 6);
    const cheaper = createUsagePricer({
      anthropic: { "claude-opus-5-5": { base: [{ minPrompt: 0, rates: opusRates }], tiers: {} } },
    });
    const repriced = createUsagePricer({
      anthropic: {
        "claude-opus-5-5": {
          base: [{ minPrompt: 0, rates: { ...opusRates, input: 2 } }],
          tiers: {},
        },
      },
    });
    // Other rates for other models change nothing; a new rate of a stored model reprices.
    expect(await costWith(cheaper)).toBeCloseTo(4.0002, 6);
    expect(await costWith(repriced)).toBeCloseTo(2.0002, 6);
  });

  test("drops the units of a replaced or removed source", async () => {
    await write(source("/p/a.jsonl", [unit()]));
    expect((await report()).byRuntime).toHaveLength(1);
    await write(source("/p/a.jsonl", []));
    expect((await report()).byRuntime).toEqual([]);
    await write(source("/p/a.jsonl", [unit()]));
    const [stored] = await sources();
    if (!stored) throw new Error("Expected a source.");
    await Effect.runPromise(
      store.read({
        calendar: utc,
        pricer,
        sync: (writer) => writer.removeSource(stored.id),
        report: () => Effect.void,
      }),
    );
    expect((await report()).byRuntime).toEqual([]);
  });

  test("builds the unit indexes of a first read for the changes of the next reads", async () => {
    await write(source("/p/a.jsonl", [unit()]));
    // A changed source of a later read finds its earlier dates through the unit indexes.
    await write(source("/p/a.jsonl", [unit({ occurredAtMs: Date.UTC(2026, 10, 20) })]));
    expect((await report(utc, "2026-11-04", "2026-11-04")).byRuntime).toEqual([]);
    expect((await report(utc, "2026-11-20", "2026-11-20")).byRuntime).toHaveLength(1);
  });

  test("reads the names and prices of another connection, and rolls back a failed read", async () => {
    // Both stores read before the other one writes, as two hosts that share the index.
    const other = createUsageIndexStore(indexPath());
    try {
      await report();
      await sources(other);
      // A failed read leaves nothing behind, and the next read of its store opens again.
      const failed = await Effect.runPromiseExit(
        other.read({
          calendar: utc,
          pricer,
          sync: (writer) =>
            writer
              .applySource(source("/p/lost.jsonl", [unit({ identity: "x", session: "lost" })]))
              .pipe(Effect.andThen(Effect.fail("stopped"))),
          report: () => Effect.void,
        }),
      );
      expect(failed._tag).toBe("Failure");
      // A complete read commits its sources and their rollup together.
      await Effect.runPromise(
        other.read({
          calendar: utc,
          pricer,
          sync: (writer) => writer.applySource(source("/p/other.jsonl", [unit()])),
          report: () => Effect.void,
        }),
      );
      const result = await report();
      expect(result.byModel.map((row) => [row.provider, row.model, row.costUsd])).toEqual([
        ["anthropic", "claude-opus-5-5", 4.0002],
      ]);
      expect((await sources()).map((row) => row.path)).toEqual(["/p/other.jsonl"]);
    } finally {
      await Effect.runPromise(other.close());
    }
  });

  test("sums the widest accepted range by month", async () => {
    await write(source("/p/a.jsonl", [unit()]));
    const periods = usagePeriods(USAGE_FIRST_DATE, USAGE_LAST_DATE, "month");
    expect(periods).toHaveLength(1_200);
    const result = await snapshotOf((snapshot) =>
      snapshot.aggregate({
        start: USAGE_FIRST_DATE,
        end: USAGE_LAST_DATE,
        runtimes: ["claude", "codex", "opencode"],
        periods,
        projectGroups: [],
      }),
    );
    expect(result.periods).toEqual([expect.objectContaining({ period: 322, input: 1_000_000 })]);
  });

  test("dates activity again in another time zone", async () => {
    await write(source("/p/a.jsonl", [unit({ occurredAtMs: Date.parse("2026-11-04T23:30:00Z") })]));
    const day = (calendar: ReturnType<typeof createUsageCalendar>) =>
      report(calendar, "2026-11-05", "2026-11-05").then((result) => result.byRuntime.length);
    expect(await day(utc)).toBe(0);
    expect(await day(createUsageCalendar("Europe/Paris"))).toBe(1);
  });
});
