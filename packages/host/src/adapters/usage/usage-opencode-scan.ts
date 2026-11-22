import { Effect } from "effect";
import { z } from "zod";
import type {
  SqliteDatabase,
  SqliteStatement,
  SqliteValue,
} from "../../infrastructure/sqlite/sqlite-driver";

/** The root session of each session of a session table, through `parent_id`. */
export const rootsOf = (table: string) => `root(id, root_id) AS (
  SELECT id, id FROM ${table} WHERE parent_id IS NULL
  UNION ALL SELECT s.id, r.root_id FROM ${table} s JOIN root r ON s.parent_id = r.id
)`;

/** Row IDs of one window. Windows keep each scan in row ID order and let it report progress. */
const WINDOW_ROWS = 20_000;

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
) =>
  Effect.gen(function* () {
    const rows: SqliteValue[][] = [];
    const positions = scans.map(() => 0);
    const statements: SqliteStatement[] = [];
    try {
      for (const scan of scans)
        statements.push(yield* database.prepare(`${scan.sql} AND m.rowid > ? AND m.rowid <= ?`));
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
    } finally {
      for (const statement of statements) yield* statement.close().pipe(Effect.ignore);
    }
    return rows;
  });

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
