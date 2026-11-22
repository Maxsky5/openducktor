import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import {
  openSqliteDatabase,
  type SqliteDatabase,
  type SqliteValue,
} from "../../infrastructure/sqlite/sqlite-driver";

/**
 * What a read saw of one message table: its newest update, its last row ID, and a digest of the
 * row IDs and message IDs up to that row ID. A later read compares the digest to find deletions.
 */
const tableStateSchema = z.object({
  mark: z.number(),
  lastRowId: z.number(),
  /** SHA-1 of the row IDs and message IDs of the rows up to `lastRowId`, in row ID order. */
  digest: z.string(),
});
type TableState = z.infer<typeof tableStateSchema>;

/** The state of the OpenCode 2 and OpenCode 1 message tables. */
export const openCodeParserStateSchema = z.object({
  v2: tableStateSchema.nullable(),
  v1: tableStateSchema.nullable(),
});
export type OpenCodeParserState = z.infer<typeof openCodeParserStateSchema>;

export type OpenCodeRead =
  | { kind: "units"; units: UsageUnit[]; state: OpenCodeParserState; mode: "replace" | "append" }
  | { kind: "unsupported" };

const V2_COLUMNS = {
  session_message: ["id", "session_id", "type", "time_created", "time_updated", "data"],
  session_v2: ["id", "parent_id", "directory", "project_id", "version"],
  project: ["id", "worktree"],
};
const V1_COLUMNS = {
  message: ["id", "session_id", "time_created", "time_updated", "data"],
  session: ["id", "parent_id", "directory", "version"],
};

const rootsOf = (table: string) => `root(id, root_id) AS (
  SELECT id, id FROM ${table} WHERE parent_id IS NULL
  UNION ALL SELECT s.id, r.root_id FROM ${table} s JOIN root r ON s.parent_id = r.id
)`;

const TOKEN_FIELDS = (path: string) => `
  json_extract(${path}, '$.tokens.input'), json_extract(${path}, '$.tokens.output'),
  json_extract(${path}, '$.tokens.reasoning'), json_extract(${path}, '$.tokens.cache.read'),
  json_extract(${path}, '$.tokens.cache.write'),
  json_extract(${path}, '$.time.completed') IS NOT NULL OR json_type(${path}, '$.error') IS NOT NULL
    OR json_extract(${path}, '$.status') IN ('completed', 'failed')`;

// Selected columns: time, session, root, project, version, provider, model, 5 tokens, settled, v1 total.
const v2Query = (withV1: boolean) => `
WITH RECURSIVE ${rootsOf("session_v2")}
SELECT m.time_created, m.session_id, r.root_id,
  CASE WHEN p.worktree IS NOT NULL AND p.worktree <> '/' THEN p.worktree ELSE s.directory END,
  s.version, json_extract(m.data, '$.model.providerID'), json_extract(m.data, '$.model.id'),
  ${TOKEN_FIELDS("m.data")},
  ${withV1 ? "json_extract(v1.data, '$.tokens.total')" : "NULL"}
FROM session_message m
JOIN session_v2 s ON s.id = m.session_id
LEFT JOIN root r ON r.id = m.session_id
LEFT JOIN project p ON p.id = s.project_id
${withV1 ? "LEFT JOIN message v1 ON v1.id = m.id" : ""}
WHERE (m.time_updated >= ? OR m.rowid > ?) AND m.type IN ('assistant', 'compaction')`;

const V1_QUERY = `
WITH RECURSIVE ${rootsOf("session")}
SELECT m.time_created, m.session_id, r.root_id,
  coalesce(json_extract(m.data, '$.path.root'), s.directory),
  s.version, json_extract(m.data, '$.providerID'), json_extract(m.data, '$.modelID'),
  ${TOKEN_FIELDS("m.data")},
  json_extract(m.data, '$.tokens.total')
FROM message m
JOIN session s ON s.id = m.session_id
LEFT JOIN root r ON r.id = m.session_id
WHERE (m.time_updated >= ? OR m.rowid > ?) AND json_extract(m.data, '$.role') = 'assistant'`;

const count = z.number().int().nonnegative().nullable().catch(null);
const text = z.string().min(1).nullable().catch(null);

/** The columns of the two message queries, in order. */
const messageRowSchema = z
  .tuple([
    count,
    text,
    text,
    text,
    text,
    text,
    text,
    count,
    count,
    count,
    count,
    count,
    z.number().catch(0),
    count,
  ])
  .transform(
    ([
      createdAtMs,
      sessionId,
      rootId,
      project,
      version,
      provider,
      model,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      settled,
      total,
    ]) => ({
      createdAtMs,
      session: rootId ?? sessionId,
      project,
      version,
      provider,
      model,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      settled: settled === 1,
      total,
    }),
  );

const scalarSchema = z.tuple([count]).transform(([value]) => value ?? 0);
const columnNameSchema = z.tuple([z.unknown(), z.string()]).rest(z.unknown());

/** Versions before 1.3.16 stored output with reasoning included. */
const storesReasoningInOutput = (version: string | null): boolean => {
  const match = version === null ? null : /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return major < 1 || (major === 1 && (minor < 3 || (minor === 3 && patch < 16)));
};

/**
 * One assistant message. Forks copy messages with new IDs but keep their creation time and
 * tokens, so that content forms the identity: every copy is the same request.
 */
const unitOf = (values: SqliteValue[]): UsageUnit | null => {
  const parsed = messageRowSchema.safeParse(values);
  if (!parsed.success) return null;
  const row = parsed.data;
  const { input, output, reasoning, cacheRead, cacheWrite } = row;
  // An unsettled message is still running. A later read counts it once it settles. A settled
  // message without tokens is model activity without a measurement.
  if (row.createdAtMs === null || row.session === null || !row.settled) return null;
  const reasoningCount = reasoning ?? 0;
  const measured =
    input !== null && output !== null && cacheRead !== null && cacheWrite !== null
      ? { input, output, cacheRead, cacheWrite }
      : null;
  const reasoningInOutput =
    row.total !== null
      ? reasoningCount > 0 &&
        measured !== null &&
        row.total === measured.input + measured.output + measured.cacheRead + measured.cacheWrite
      : storesReasoningInOutput(row.version);
  return {
    identity: [
      row.createdAtMs,
      row.provider,
      row.model,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
    ].join("|"),
    occurredAtMs: row.createdAtMs,
    session: row.session,
    provider: row.provider,
    model: row.model,
    project: row.project,
    serviceTier: null,
    tokens: measured
      ? {
          input: measured.input,
          cacheRead: measured.cacheRead,
          cacheWrite5m: measured.cacheWrite,
          cacheWrite1h: 0,
          output: reasoningInOutput ? measured.output : measured.output + reasoningCount,
        }
      : null,
  };
};

const columnsOf = (database: SqliteDatabase, table: string) =>
  database.prepare(`PRAGMA table_info(${table})`).pipe(
    Effect.flatMap((statement) => statement.values()),
    Effect.map(
      (rows) =>
        new Set(
          rows.flatMap((row) => {
            const parsed = columnNameSchema.safeParse(row);
            return parsed.success ? [parsed.data[1]] : [];
          }),
        ),
    ),
  );

const hasColumns = (
  database: SqliteDatabase,
  tables: Record<string, readonly string[]>,
): Effect.Effect<boolean | "absent", HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    let found = 0;
    const entries = Object.entries(tables);
    for (const [table, columns] of entries) {
      const present = yield* columnsOf(database, table);
      if (present.size === 0) continue;
      found++;
      if (!columns.every((column) => present.has(column))) return false;
    }
    if (found === 0) return "absent";
    return found === entries.length;
  });

const scalar = (database: SqliteDatabase, sql: string) =>
  database.prepare(sql).pipe(
    Effect.flatMap((statement) => statement.values()),
    Effect.map((rows) => scalarSchema.catch(0).parse(rows[0] ?? [null])),
  );

/**
 * Rows updated at or after the mark, and rows added after the last row ID. A fork copies messages
 * with their old update time, so only the row ID shows them.
 */
const readRows = (
  database: SqliteDatabase,
  sql: string,
  cursor: { mark: number; afterRowId: number },
) =>
  database
    .prepare(sql)
    .pipe(
      Effect.flatMap((statement) =>
        statement
          .values(cursor.mark, cursor.afterRowId)
          .pipe(Effect.ensuring(statement.close().pipe(Effect.ignore))),
      ),
    );

const identityRowSchema = z.tuple([z.number(), z.string()]);
/** Rows of one identity batch. It bounds the memory of the digest of a large table. */
const IDENTITY_BATCH = 10_000;

/**
 * Digests the row ID and message ID of each row, in row ID order: the digest of the rows up to
 * `upToRowId`, and of all rows. A message ID never repeats, so a deleted or replaced earlier row
 * changes the first digest, also when SQLite gives its row ID to a new row.
 */
const identityDigests = (database: SqliteDatabase, table: string, upToRowId: number) =>
  Effect.acquireUseRelease(
    database.prepare(
      `SELECT rowid, id FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${IDENTITY_BATCH}`,
    ),
    (statement) =>
      Effect.gen(function* () {
        const hash = createHash("sha1");
        let earlier: string | null = upToRowId < 0 ? hash.copy().digest("hex") : null;
        let afterRowId = Number.MIN_SAFE_INTEGER;
        for (;;) {
          const rows = yield* statement.values(afterRowId);
          for (const row of rows) {
            const [rowId, id] = identityRowSchema.parse(row);
            if (earlier === null && rowId > upToRowId) earlier = hash.copy().digest("hex");
            hash.update(`${rowId}\u0000${id}\u0000`);
            afterRowId = rowId;
          }
          if (rows.length < IDENTITY_BATCH) break;
        }
        return { earlier: earlier ?? hash.copy().digest("hex"), all: hash.digest("hex") };
      }),
    (statement) => statement.close().pipe(Effect.ignore),
  );

const FULL_READ = { mark: 0, afterRowId: -1 };

/**
 * Reads the state of one message table. The rows up to the last row ID of the previous read must
 * be the same rows, or a deletion happened and the table needs a full read.
 */
const readTableState = (database: SqliteDatabase, table: string, previous: TableState | null) =>
  Effect.gen(function* () {
    const mark = yield* scalar(database, `SELECT MAX(time_updated) FROM ${table}`);
    const lastRowId = yield* scalar(database, `SELECT MAX(rowid) FROM ${table}`);
    const digests = yield* identityDigests(database, table, previous?.lastRowId ?? -1);
    const unchangedRows = previous !== null && digests.earlier === previous.digest;
    return {
      state: { mark, lastRowId, digest: digests.all } satisfies TableState,
      cursor: unchangedRows ? { mark: previous.mark, afterRowId: previous.lastRowId } : FULL_READ,
    };
  });

/**
 * Reads assistant messages of an OpenCode database, read-only. OpenCode 2 stores them in
 * `session_message`. The frozen OpenCode 1 `message` table still holds a few messages that the
 * version 2 copy skipped, so both tables count.
 */
export const readOpenCodeUsage = (
  path: string,
  previous: OpenCodeParserState | null,
): Effect.Effect<OpenCodeRead, HostOperationErrorAggregate> =>
  Effect.acquireUseRelease(
    openSqliteDatabase(path, undefined, { readonly: true }),
    (database) =>
      Effect.gen(function* () {
        yield* database.exec("PRAGMA busy_timeout = 1000");
        // One read transaction: the table states and the rows come from the same snapshot.
        yield* database.exec("BEGIN");
        const v2 = yield* hasColumns(database, V2_COLUMNS);
        const v1 = yield* hasColumns(database, V1_COLUMNS);
        if (v2 === false || v1 === false || (v2 === "absent" && v1 === "absent"))
          return { kind: "unsupported" } as const;
        const v2Table =
          v2 === true
            ? yield* readTableState(database, "session_message", previous?.v2 ?? null)
            : null;
        const v1Table =
          v1 === true ? yield* readTableState(database, "message", previous?.v1 ?? null) : null;
        // A deletion in either table reads both again, because the index replaces the whole source.
        const replace =
          previous === null ||
          (v2Table !== null && v2Table.cursor === FULL_READ) ||
          (v1Table !== null && v1Table.cursor === FULL_READ);
        const rows = [
          ...(v2Table
            ? yield* readRows(
                database,
                v2Query(v1Table !== null),
                replace ? FULL_READ : v2Table.cursor,
              )
            : []),
          ...(v1Table
            ? yield* readRows(database, V1_QUERY, replace ? FULL_READ : v1Table.cursor)
            : []),
        ];
        const units: UsageUnit[] = [];
        for (const row of rows) {
          const unit = unitOf(row);
          if (unit) units.push(unit);
        }
        return {
          kind: "units",
          units,
          mode: replace ? "replace" : "append",
          state: { v2: v2Table?.state ?? null, v1: v1Table?.state ?? null },
        } as const;
      }),
    (database) => database.close().pipe(Effect.ignore),
  );
