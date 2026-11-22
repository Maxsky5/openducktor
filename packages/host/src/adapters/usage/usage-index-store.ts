import { chmod } from "node:fs/promises";
import type { RuntimeKind } from "@openducktor/contracts";
import { Cause, Effect } from "effect";
import {
  addDays,
  USAGE_SLOT_MS,
  type UsageCalendar,
  type UsageDate,
} from "../../domain/usage/usage-calendar";
import type { UsagePricer } from "../../domain/usage/usage-pricing";
import type { UsageIssueRow } from "../../ports/usage-index-port";
import { type HostOperationErrorAggregate, HostOperationError } from "../../effect/host-errors";
import { createUsageNameCache } from "./usage-index-names";
import { createUsagePriceTable } from "./usage-index-prices";
import {
  aggregateUsage,
  issueCodeOf,
  nullableNum,
  num,
  runtimeOf,
  str,
  type UsageAggregateInput,
} from "./usage-index-rows";
import {
  USAGE_INDEX_DROP_TABLES,
  USAGE_INDEX_DROP_UNIT_INDEXES,
  USAGE_INDEX_FORMAT_VERSION,
  USAGE_INDEX_ROLLUP_SQL,
  USAGE_INDEX_SCHEMA,
  USAGE_INDEX_TEMP_TABLES,
  USAGE_INDEX_UNIT_INDEXES,
} from "./usage-index-sql";
import type { StoredUsageRates, UsageRateStorage } from "./usage-rate-catalog";
import {
  createUsageSourceWriter,
  type UsageReadChanges,
  type UsageSourceRow,
  type UsageSourceUpdate,
} from "./usage-index-sources";
import {
  openSqliteDatabase,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteValue,
} from "../../infrastructure/sqlite/sqlite-driver";

/** Brings the sources of a read into the index. */
export type UsageIndexWriter = {
  sources: () => Effect.Effect<UsageSourceRow[], HostOperationErrorAggregate>;
  applySource: (update: UsageSourceUpdate) => Effect.Effect<void, HostOperationErrorAggregate>;
  removeSource: (sourceId: number) => Effect.Effect<void, HostOperationErrorAggregate>;
};

/** Reads the figures of the index after its rollup is up to date. */
export type UsageIndexSnapshot = {
  /** The earliest activity date of each runtime with activity. */
  earliestDates: () => Effect.Effect<
    Partial<Record<RuntimeKind, UsageDate>>,
    HostOperationErrorAggregate
  >;
  issues: () => Effect.Effect<UsageIssueRow[], HostOperationErrorAggregate>;
  aggregate: (input: UsageAggregateInput) => ReturnType<typeof aggregateUsage>;
};

/** Days of one batch of a full rollup. */
const ROLLUP_BATCH_DAYS = 31;

const storageError = (cause: unknown) =>
  new HostOperationError({
    operation: "usage.index.open",
    message:
      "OpenDucktor cannot open its usage index. Delete usage-index.sqlite in the OpenDucktor config folder, then retry.",
    cause,
  });

export type UsageIndexStore = ReturnType<typeof createUsageIndexStore>;

/**
 * The usage index: a disposable cache of the native history. It opens its connection on the
 * first read. A failed read closes the connection, which rolls the read back and drops the
 * name and price caches of that connection, and the next read opens a new one.
 */
export const createUsageIndexStore = (path: string) => {
  let connection: Connection | null = null;

  const discard = (current: Connection) =>
    Effect.suspend(() => {
      if (connection === current) connection = null;
      // A close failure cannot hide the read failure.
      return current
        .close()
        .pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => console.error("Usage index close failed", Cause.squash(cause))),
          ),
        );
    });

  /** Runs `work` on the open connection. A failure closes the connection. */
  const withConnection = <A, E>(work: (current: Connection) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      connection ??= yield* openConnection(path);
      const current = connection;
      return yield* work(current).pipe(Effect.onError(() => discard(current)));
    });

  const rates: UsageRateStorage = {
    load: () => withConnection((current) => current.loadRates()),
    save: (stored) => withConnection((current) => current.saveRates(stored)),
    touch: (fetchedAtMs) => withConnection((current) => current.touchRates(fetchedAtMs)),
  };

  return {
    /**
     * Runs one read in one write transaction: `sync` brings the sources into the index, the
     * rollup comes up to date with the rates of `pricer`, and `report` reads the figures. They
     * always belong together, also when another host shares the file: the transaction holds the
     * write lock.
     */
    read: <S, A, SyncError, ReportError>(
      calendar: UsageCalendar,
      pricer: UsagePricer,
      sync: (writer: UsageIndexWriter) => Effect.Effect<S, SyncError>,
      report: (snapshot: UsageIndexSnapshot, synced: S) => Effect.Effect<A, ReportError>,
      /** Gets the share of a full rollup that is built. */
      onRollup: (fraction: number) => void = () => {},
    ): Effect.Effect<A, HostOperationErrorAggregate | SyncError | ReportError> =>
      withConnection((current) => current.read(calendar, pricer, sync, report, onRollup)),

    /** The stored rate catalog. */
    rates,

    close: () =>
      Effect.suspend(() => {
        const current = connection;
        connection = null;
        return current ? current.close() : Effect.void;
      }),
  };
};

/** Opens a connection. A different format version resets the tables in place. */
const openConnection = (path: string): Effect.Effect<Connection, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const database = yield* openSqliteDatabase(path).pipe(Effect.mapError(storageError));
    yield* Effect.tryPromise({ try: () => chmod(path, 0o600), catch: storageError });
    yield* database.exec(
      // A first read writes one large transaction; the limit shrinks the log after it.
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -65536; PRAGMA journal_size_limit = 67108864;",
    );
    // The format decision runs under the write lock, so two hosts that open the index together
    // cannot both reset it.
    yield* prepareFormat(database).pipe(
      Effect.tapError(() => database.close().pipe(Effect.ignore)),
    );
    yield* database.exec(USAGE_INDEX_TEMP_TABLES);
    const opened = createConnection(database);
    yield* opened.syncNames();
    return opened;
  });

/** Creates the tables, or resets them when the stored format differs. */
const prepareFormat = (database: SqliteDatabase) =>
  Effect.gen(function* () {
    yield* database.exec("BEGIN IMMEDIATE");
    const version = yield* database.prepare("PRAGMA user_version").pipe(
      Effect.flatMap((statement) => statement.values()),
      Effect.mapError(storageError),
    );
    yield* database.exec(
      num(version[0]?.[0]) === USAGE_INDEX_FORMAT_VERSION
        ? USAGE_INDEX_SCHEMA
        : `${USAGE_INDEX_DROP_TABLES} ${USAGE_INDEX_SCHEMA} PRAGMA user_version = ${USAGE_INDEX_FORMAT_VERSION};`,
    );
    yield* database.exec("COMMIT");
  });

type Connection = ReturnType<typeof createConnection>;

const createConnection = (database: SqliteDatabase) => {
  const statements = new Map<string, SqliteStatement>();
  const prepared = (sql: string) =>
    Effect.gen(function* () {
      const cached = statements.get(sql);
      if (cached) return cached;
      const statement = yield* database.prepare(sql);
      statements.set(sql, statement);
      return statement;
    });
  const run = (sql: string, ...params: SqliteValue[]) =>
    prepared(sql).pipe(Effect.flatMap((statement) => statement.run(...params)));
  const values = (sql: string, ...params: SqliteValue[]) =>
    prepared(sql).pipe(Effect.flatMap((statement) => statement.values(...params)));
  const names = createUsageNameCache({ values, run });
  const prices = createUsagePriceTable({ run }, names);
  const { applySource, dropUnits, sources } = createUsageSourceWriter({ values, run }, names);

  const recomputeTargets = (calendar: UsageCalendar, dates: Iterable<UsageDate>) =>
    Effect.gen(function* () {
      yield* run("DELETE FROM target");
      const list = [...dates];
      for (let start = 0; start < list.length; start += 300) {
        const batch = list.slice(start, start + 300);
        yield* run(
          `INSERT OR IGNORE INTO target VALUES ${batch.map(() => "(?, ?, ?)").join(", ")}`,
          ...batch.flatMap((date) => [
            calendar.startOf(date),
            calendar.startOf(addDays(date, 1)),
            date,
          ]),
        );
      }
      yield* run("DELETE FROM day WHERE local_date IN (SELECT local_date FROM target)");
      yield* run(USAGE_INDEX_ROLLUP_SQL);
    });

  /** True when the rollup has another time zone or other rates than the read. */
  const rollupOutdated = (calendar: UsageCalendar, priceDigest: string) =>
    values("SELECT key, value FROM meta").pipe(
      Effect.map((rows) => {
        const meta = new Map(rows.map((row) => [str(row[0]), str(row[1])]));
        return (
          meta.get("timeZone") !== calendar.timeZone || meta.get("priceDigest") !== priceDigest
        );
      }),
    );

  const allDates = (calendar: UsageCalendar) =>
    Effect.gen(function* () {
      const rows = yield* values("SELECT MIN(occurred_at_ms), MAX(occurred_at_ms) FROM unit");
      const first = nullableNum(rows[0]?.[0]);
      const last = nullableNum(rows[0]?.[1]);
      const dates: UsageDate[] = [];
      if (first === null || last === null) return dates;
      const end = calendar.dateOf(last);
      for (let date = calendar.dateOf(first); date <= end; date = addDays(date, 1))
        dates.push(date);
      return dates;
    });

  /**
   * Brings the rollup up to date. An empty index, or a different time zone or other rates,
   * rebuilds all of it. Otherwise it recomputes the dates of every copy of the touched units.
   */
  const refreshRollup = (
    changes: UsageReadChanges,
    calendar: UsageCalendar,
    pricer: UsagePricer,
    onRollup: (fraction: number) => void,
  ) =>
    Effect.gen(function* () {
      // Another host that shares the index can add names that need a price.
      yield* names.sync();
      const priceDigest = yield* prices.update(pricer);
      const touchedCount = num((yield* values("SELECT COUNT(*) FROM touched"))[0]?.[0]);
      if (!changes.rebuild && touchedCount === 0 && changes.removedSlots.size === 0) return;
      if (changes.rebuild) {
        yield* run("DELETE FROM day");
        // A full rollup takes seconds, so it goes in month-sized batches that report progress.
        const dates = yield* allDates(calendar);
        for (let start = 0; start < dates.length; start += ROLLUP_BATCH_DAYS) {
          yield* recomputeTargets(calendar, dates.slice(start, start + ROLLUP_BATCH_DAYS));
          onRollup(Math.min(1, (start + ROLLUP_BATCH_DAYS) / dates.length));
        }
      } else {
        const slots = new Set(changes.removedSlots);
        const rows = yield* values(
          `SELECT DISTINCT u.occurred_at_ms / ${USAGE_SLOT_MS} FROM touched t CROSS JOIN unit u INDEXED BY unit_by_key ON u.unit_key = t.unit_key`,
        );
        for (const row of rows) slots.add(num(row[0]));
        const dates = new Set<UsageDate>();
        for (const slot of slots) dates.add(calendar.dateOf(slot * USAGE_SLOT_MS));
        yield* recomputeTargets(calendar, dates);
      }
      yield* run("DELETE FROM touched");
      yield* run("INSERT OR REPLACE INTO meta VALUES ('timeZone', ?)", calendar.timeZone);
      yield* run("INSERT OR REPLACE INTO meta VALUES ('priceDigest', ?)", priceDigest);
    });

  const snapshot: UsageIndexSnapshot = {
    earliestDates: () =>
      Effect.gen(function* () {
        const dates: Partial<Record<RuntimeKind, UsageDate>> = {};
        for (const row of yield* values(
          "SELECT runtime, MIN(local_date) FROM day GROUP BY runtime",
        ))
          dates[runtimeOf(row[0])] = str(row[1]);
        return dates;
      }),

    issues: () =>
      Effect.gen(function* () {
        const rows = yield* values(
          "SELECT runtime, issue_code, issue_first_ms, issue_last_ms FROM source WHERE issue_code IS NOT NULL",
        );
        return rows.map((row): UsageIssueRow => ({
          runtime: runtimeOf(row[0]),
          code: issueCodeOf(row[1]),
          firstAtMs: nullableNum(row[2]),
          lastAtMs: nullableNum(row[3]),
        }));
      }),

    aggregate: (input) => aggregateUsage({ values, run }, input),
  };

  return {
    /** Reads the stored names. */
    syncNames: () => names.sync(),

    loadRates: () =>
      values("SELECT fetched_at_ms, etag, document FROM rate_catalog WHERE id = 1").pipe(
        Effect.map((rows): StoredUsageRates | null => {
          const row = rows[0];
          if (!row) return null;
          return {
            fetchedAtMs: num(row[0]),
            etag: row[1] === null ? null : str(row[1]),
            document: str(row[2]),
          };
        }),
      ),

    saveRates: (stored: StoredUsageRates) =>
      run(
        "INSERT OR REPLACE INTO rate_catalog (id, fetched_at_ms, etag, document) VALUES (1, ?, ?, ?)",
        stored.fetchedAtMs,
        stored.etag,
        stored.document,
      ).pipe(Effect.asVoid),

    touchRates: (fetchedAtMs: number) =>
      run("UPDATE rate_catalog SET fetched_at_ms = ? WHERE id = 1", fetchedAtMs).pipe(
        Effect.asVoid,
      ),

    read: <S, A, SyncError, ReportError>(
      calendar: UsageCalendar,
      pricer: UsagePricer,
      sync: (writer: UsageIndexWriter) => Effect.Effect<S, SyncError>,
      report: (snapshot: UsageIndexSnapshot, synced: S) => Effect.Effect<A, ReportError>,
      onRollup: (fraction: number) => void,
    ) =>
      Effect.gen(function* () {
        yield* database.exec("BEGIN IMMEDIATE");
        const empty = (yield* values("SELECT 1 FROM unit LIMIT 1")).length === 0;
        // The rates of the names before this read. New names only price new units.
        yield* names.sync();
        const priceDigest = yield* prices.update(pricer);
        const changes: UsageReadChanges = {
          rebuild: empty || (yield* rollupOutdated(calendar, priceDigest)),
          removedSlots: new Set(),
        };
        // Index updates make up most of the insert time of a first read. Building the indexes
        // after the last insert is much faster. The rollup and the next reads use them.
        if (empty) yield* database.exec(USAGE_INDEX_DROP_UNIT_INDEXES);
        const synced = yield* sync({
          sources,
          applySource: (update) => applySource(changes, update),
          removeSource: (sourceId) =>
            dropUnits(changes, sourceId).pipe(
              Effect.andThen(run("DELETE FROM source WHERE id = ?", sourceId)),
              Effect.asVoid,
            ),
        });
        if (empty) yield* database.exec(USAGE_INDEX_UNIT_INDEXES);
        yield* refreshRollup(changes, calendar, pricer, onRollup);
        const result = yield* report(snapshot, synced);
        yield* database.exec("COMMIT");
        return result;
      }),

    close: () =>
      Effect.gen(function* () {
        for (const statement of statements.values()) yield* statement.close();
        statements.clear();
        yield* database.close();
      }),
  };
};
