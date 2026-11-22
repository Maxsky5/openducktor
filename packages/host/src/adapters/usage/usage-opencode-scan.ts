import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SqliteDatabase, SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";

/** The root session of each session of a session table, through `parent_id`. */
export const rootsOf = (table: string) => `root(id, root_id) AS (
  SELECT id, id FROM ${table} WHERE parent_id IS NULL
  UNION ALL SELECT s.id, r.root_id FROM ${table} s JOIN root r ON s.parent_id = r.id
)`;

/** A statement that closes when its scope closes. */
export const scopedStatement = (database: SqliteDatabase, sql: string) =>
  Effect.acquireRelease(database.prepare(sql), (statement) =>
    statement.close().pipe(Effect.ignore),
  );

/** Row IDs of one window. Windows keep each scan in row ID order and let it report progress. */
const WINDOW_ROWS = 5_000;

/** One message table to scan: its query, its cursor, and its last row ID. */
export type TableScan = {
  sql: string;
  cursor: { mark: number; afterRowId: number };
  lastRowId: number;
};

/**
 * Rows updated at or after the mark, and rows added after the last row ID. A fork copies messages
 * with their old update time, so only the row ID shows them. Each table is scanned in row ID
 * windows, and the next window always comes from the table with the smaller scanned share, so
 * both tables advance together. `onWindow` gets the scanned row ID of each table.
 */
export const readRows = (
  database: SqliteDatabase,
  scans: readonly TableScan[],
  onWindow: (positions: readonly number[]) => void,
  /** Runs before the rows of each window, such as the digest of a first read. */
  beforeWindow: (
    index: number,
    start: number,
    end: number,
  ) => Effect.Effect<void, HostOperationErrorAggregate> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const rows: SqliteValue[][] = [];
    const positions = scans.map(() => 0);
    const statements = yield* Effect.forEach(scans, (scan) =>
      scopedStatement(database, `${scan.sql} AND m.rowid > ? AND m.rowid <= ?`),
    );
    for (;;) {
      let next = -1;
      for (const [index, scan] of scans.entries()) {
        const position = positions[index] ?? 0;
        if (position >= scan.lastRowId) continue;
        const share = position / scan.lastRowId;
        const best = scans[next];
        if (next < 0 || (best && share < (positions[next] ?? 0) / best.lastRowId)) next = index;
      }
      const scan = scans[next];
      const statement = statements[next];
      if (!scan || !statement) break;
      const start = positions[next] ?? 0;
      const end = Math.min(start + WINDOW_ROWS, scan.lastRowId);
      yield* beforeWindow(next, start, end);
      for (const row of yield* statement.values(
        scan.cursor.mark,
        scan.cursor.afterRowId,
        start,
        end,
      ))
        rows.push(row);
      positions[next] = end;
      onWindow(positions);
    }
    return rows;
  }).pipe(Effect.scoped);

const lastRowSchema = z.tuple([z.string(), z.number()]);

/** The last row ID of each root session in a message table. The session index serves it. */
const lastRowsOfRoots = (database: SqliteDatabase, sessionTable: string, messageTable: string) =>
  database
    .prepare(
      `WITH RECURSIVE ${rootsOf(sessionTable)},
      last(session_id, row_id) AS (SELECT session_id, MAX(rowid) FROM ${messageTable} GROUP BY session_id)
      SELECT r.root_id, MAX(l.row_id) FROM last l JOIN root r ON r.id = l.session_id GROUP BY r.root_id`,
    )
    .pipe(
      Effect.flatMap((statement) =>
        statement.values().pipe(Effect.ensuring(statement.close().pipe(Effect.ignore))),
      ),
      Effect.map((rows) =>
        rows.flatMap((row) => {
          const parsed = lastRowSchema.safeParse(row);
          return parsed.success ? [parsed.data] : [];
        }),
      ),
    );

/**
 * Counts the root sessions that the scan passed: a root session is read once the scan of each
 * table passed its last row there.
 */
const createSessionCounter = (ends: ReadonlyMap<string, readonly number[]>) => ({
  total: ends.size,
  doneAt: (positions: readonly number[]) => {
    let done = 0;
    for (const last of ends.values())
      if (last.every((rowId, index) => rowId <= (positions[index] ?? 0))) done++;
    return done;
  },
});

/** One message table of the database and the session table that its rows belong to. */
export type MessageTable = { name: string; sessions: string };

/** The last row ID of each root session in each table, in the order of `tables`. */
export const sessionEnds = (database: SqliteDatabase, tables: readonly MessageTable[]) =>
  Effect.gen(function* () {
    const ends = new Map<string, number[]>();
    for (const [index, table] of tables.entries())
      for (const [root, rowId] of yield* lastRowsOfRoots(database, table.sessions, table.name)) {
        const last = ends.get(root) ?? tables.map(() => 0);
        last[index] = rowId;
        ends.set(root, last);
      }
    return createSessionCounter(ends);
  });

const identityRowSchema = z.tuple([z.number(), z.string(), z.number().nullable().catch(null)]);
/** Rows of one identity batch. It bounds the memory of the digest of a large table. */
const IDENTITY_BATCH = 10_000;

/**
 * A digest of the row ID and message ID of each row, in row ID order: of the rows up to
 * `upToRowId`, and of all rows. A message ID never repeats, so a deleted or replaced earlier row
 * changes the first digest, also when SQLite gives its row ID to a new row. It also finds the
 * newest update.
 */
export const createIdentityDigest = (upToRowId: number) => {
  const hash = createHash("sha1");
  let earlier: string | null = upToRowId < 0 ? hash.copy().digest("hex") : null;
  let lastRowId = Number.MIN_SAFE_INTEGER;
  let mark = 0;
  return {
    add: (rows: readonly SqliteValue[][]) => {
      for (const row of rows) {
        const [rowId, id, updated] = identityRowSchema.parse(row);
        if (earlier === null && rowId > upToRowId) earlier = hash.copy().digest("hex");
        hash.update(`${rowId}\u0000${id}\u0000`);
        lastRowId = rowId;
        if (updated !== null && updated > mark) mark = updated;
      }
    },
    lastRowId: () => lastRowId,
    result: () => ({
      earlier: earlier ?? hash.copy().digest("hex"),
      all: hash.digest("hex"),
      mark,
    }),
  };
};

export const identityColumns = (table: string) => `SELECT rowid, id, time_updated FROM ${table}`;

/** Digests a whole table in batches, and calls `onBatch` with the row ID that it reached. */
export const identityDigests = (
  database: SqliteDatabase,
  table: string,
  upToRowId: number,
  onBatch: (rowId: number) => void,
) =>
  Effect.acquireUseRelease(
    database.prepare(
      `${identityColumns(table)} WHERE rowid > ? ORDER BY rowid LIMIT ${IDENTITY_BATCH}`,
    ),
    (statement) =>
      Effect.gen(function* () {
        const digest = createIdentityDigest(upToRowId);
        for (;;) {
          const rows = yield* statement.values(digest.lastRowId());
          digest.add(rows);
          onBatch(digest.lastRowId());
          if (rows.length < IDENTITY_BATCH) break;
        }
        return digest.result();
      }),
    (statement) => statement.close().pipe(Effect.ignore),
  );
