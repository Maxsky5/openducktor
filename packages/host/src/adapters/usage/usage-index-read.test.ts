import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { Effect } from "effect";
import { createUsagePricer } from "../../domain/usage/usage-pricing";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createUsageCheckMemo, createUsageIndexReader } from "./usage-index-read";
import { createUsageIndexStore, type UsageIndexStore } from "./usage-index-store";
import { createUsageParsePool } from "./usage-parse-pool";
import type { UsageIndexReadInput } from "./usage-worker-protocol";

const DAY = 24 * 60 * 60 * 1000;

type Runtimes = readonly (typeof knownRuntimeKindValues)[number][];

const check = (
  checkedAtMs: number,
  runtimes: Runtimes,
  sinceMs: number | null,
  stopped = false,
) => ({
  discovery: { sources: [], unreadablePaths: [], withoutHistory: [], unreadableRuntimes: [] },
  checkedAtMs,
  scope: { runtimes, sinceMs },
  stopped,
});

describe("createUsageCheckMemo", () => {
  test("reuses a recent check for fewer runtimes or a later range start", () => {
    let now = 0;
    const checks = createUsageCheckMemo(() => now);
    const reusable = (runtimes: Runtimes, sinceMs: number | null) =>
      checks.reusable({ runtimes, sinceMs });
    checks.record(check(0, ["claude", "codex"], 30 * DAY));
    now = 60_000;
    expect(reusable(["codex"], 40 * DAY)?.checkedAtMs).toBe(0);
    // Another runtime, or an earlier start, needs a check of its own.
    expect(reusable(["opencode"], 40 * DAY)).toBeNull();
    expect(reusable(["codex"], 10 * DAY)).toBeNull();
    expect(reusable(["codex"], null)).toBeNull();
    now = 5 * 60_000;
    expect(reusable(["codex"], 40 * DAY)).toBeNull();
  });

  test("reuses any range once a check covered all history, and never a stopped check", () => {
    const checks = createUsageCheckMemo(() => 1_000);
    checks.record(check(0, knownRuntimeKindValues, null, true));
    expect(checks.reusable({ runtimes: ["codex"], sinceMs: null })).toBeNull();
    checks.record(check(0, knownRuntimeKindValues, null));
    expect(checks.reusable({ runtimes: ["codex"], sinceMs: 10 * DAY })?.checkedAtMs).toBe(0);
  });

  test("needs a catch-up after a read of a range or of one runtime, until a check covers all history", () => {
    const checks = createUsageCheckMemo(() => 1_000);
    expect(checks.needsCatchUp({ runtimes: knownRuntimeKindValues, sinceMs: null })).toBe(false);
    expect(checks.needsCatchUp({ runtimes: knownRuntimeKindValues, sinceMs: DAY })).toBe(true);
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: null })).toBe(true);
    // A stopped check of all history does not count.
    checks.record(check(0, knownRuntimeKindValues, null, true));
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: DAY })).toBe(true);
    checks.record(check(0, knownRuntimeKindValues, null));
    expect(checks.needsCatchUp({ runtimes: ["codex"], sinceMs: DAY })).toBe(false);
  });
});

describe("createUsageIndexReader", () => {
  let directory = "";
  let store: UsageIndexStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "odt-usage-read-"));
    store = createUsageIndexStore(path.join(directory, "usage-index.sqlite"));
  });

  afterEach(async () => {
    await Effect.runPromise(store.close());
    await removeTestDirectory(directory);
  });

  test("keeps no check of a read whose transaction fails", async () => {
    // The sources sync, then the report fails, so the transaction rolls back.
    // SAFETY: the wrapper passes every option of `read` and replaces only `report`, so it keeps
    // the generic signature of `read`.
    const failing: UsageIndexStore = {
      ...store,
      read: ((options) =>
        store.read({
          ...options,
          report: () => Effect.fail("report failed"),
        })) as UsageIndexStore["read"],
    };
    const reader = createUsageIndexReader({ store: failing, pool: createUsageParsePool([]) });
    const input: UsageIndexReadInput = {
      timeZone: "UTC",
      runtimes: knownRuntimeKindValues,
      range: { start: null, end: "2026-11-22" },
      workspaces: [],
      refresh: false,
      separateFolders: [],
      locations: {
        claude: path.join(directory, "claude"),
        codex: [path.join(directory, "codex")],
        opencode: { directory: path.join(directory, "opencode"), databaseFile: null },
        antigravity: path.join(directory, "antigravity"),
      },
    };
    const pricing = { pricer: createUsagePricer({}), updatedAtMs: null, failure: null };

    const read = reader.read({
      input,
      pricing,
      first: true,
      isCancelled: () => false,
      onProgress: () => {},
    });
    const failure: unknown = await Effect.runPromise(Effect.flip(read));
    expect(failure).toBe("report failed");
    // A check of all history would make every later read reuse it and skip the catch-up.
    expect(
      reader.needsCatchUp({
        ...input,
        runtimes: ["codex"],
        range: { start: "2026-11-01", end: "2026-11-22" },
      }),
    ).toBe(true);
  });
});
