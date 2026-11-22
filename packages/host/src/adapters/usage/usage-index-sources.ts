import { createHash } from "node:crypto";
import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { USAGE_SLOT_MS } from "../../domain/usage/usage-calendar";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import type { UsageSourceIssue } from "../../domain/usage/usage-report";
import type { createUsageNameCache } from "./usage-index-names";
import {
  type IndexQueries,
  issueCodeOf,
  nullableNum,
  num,
  placeholderRows,
  runtimeOf,
  str,
} from "./usage-index-rows";
import type {
  UsageResumePoint,
  UsageSourceFingerprint,
  UsageStoredSource,
} from "./usage-worker-protocol";
import type { SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";

/** The columns of a unit insert, in the order of its parameters. */
const UNIT_COLUMNS = [
  "source_id",
  "unit_key",
  "runtime",
  "occurred_at_ms",
  "session_id",
  "provider_id",
  "model_id",
  "project_id",
  "tier_id",
  "input",
  "cache_read",
  "cache_write_5m",
  "cache_write_1h",
  "output",
];
const UNITS_PER_INSERT = 500;

/** A source in the index, with what its last read kept. */
export type UsageSourceRow = UsageStoredSource & { id: number; runtime: RuntimeKind; path: string };

export type UsageSourceUpdate = {
  runtime: RuntimeKind;
  path: string;
  fingerprint: UsageSourceFingerprint;
  resume: UsageResumePoint | null;
  parserState: string | null;
  issue: UsageSourceIssue | null;
  /** `replace` drops the earlier units of the source. `append` keeps them. */
  mode: "replace" | "append";
  units: readonly UsageUnit[];
};

/** What one read changed, so its rollup recomputes only those dates. */
export type UsageReadChanges = {
  /** The read rebuilds all of the rollup, so it does not keep the touched units and slots. */
  rebuild: boolean;
  /** Slots of units that left the index. Their dates need a new rollup. */
  removedSlots: Set<number>;
};

/**
 * An appended read sees only new lines. It keeps the malformed records of earlier bytes, and
 * widens their dates. Any other issue is the state of the new read.
 */
const mergeAppendIssue = (
  stored: UsageSourceIssue | null,
  next: UsageSourceIssue | null,
): UsageSourceIssue | null => {
  if (stored?.code !== "malformed_records") return next;
  if (next === null) return stored;
  if (next.code !== "malformed_records") return next;
  const first =
    stored.firstAtMs === null || next.firstAtMs === null
      ? null
      : Math.min(stored.firstAtMs, next.firstAtMs);
  const last =
    stored.lastAtMs === null || next.lastAtMs === null
      ? null
      : Math.max(stored.lastAtMs, next.lastAtMs);
  return { code: "malformed_records", firstAtMs: first, lastAtMs: last };
};

/** A signed 64-bit hash of a unit identity. The runtime is part of it, so keys never collide across runtimes. */
const unitKey = (runtime: RuntimeKind, identity: string): bigint =>
  createHash("sha256").update(`${runtime}\u0000${identity}`).digest().readBigInt64LE(0);

/**
 * The source rows and units of the index. Each write records what it changes, so the rollup of
 * the read recomputes only those dates.
 */
export const createUsageSourceWriter = (
  { run, values }: IndexQueries,
  names: ReturnType<typeof createUsageNameCache>,
) => {
  const insertUnits = (
    changes: UsageReadChanges,
    sourceId: number,
    runtime: RuntimeKind,
    units: UsageSourceUpdate["units"],
  ) =>
    Effect.gen(function* () {
      const { cachedId, idOf } = names;
      for (let start = 0; start < units.length; start += UNITS_PER_INSERT) {
        const batch = units.slice(start, start + UNITS_PER_INSERT);
        const params: SqliteValue[] = [];
        const keys: SqliteValue[] = [];
        for (const unit of batch) {
          const key = unitKey(runtime, unit.identity);
          const session = `${runtime}:${unit.session}`;
          const tokens = unit.tokens;
          params.push(
            sourceId,
            key,
            runtime,
            unit.occurredAtMs,
            // Only a new name needs a write.
            cachedId("session", session) ?? (yield* idOf("session", session)),
            cachedId("provider", unit.provider) ?? (yield* idOf("provider", unit.provider)),
            cachedId("model", unit.model) ?? (yield* idOf("model", unit.model)),
            cachedId("project", unit.project) ?? (yield* idOf("project", unit.project)),
            cachedId("tier", unit.serviceTier) ?? (yield* idOf("tier", unit.serviceTier)),
            tokens?.input ?? null,
            tokens?.cacheRead ?? null,
            tokens?.cacheWrite5m ?? null,
            tokens?.cacheWrite1h ?? null,
            tokens?.output ?? null,
          );
          keys.push(key);
        }
        // A request can span several lines of one source, and a resumed read can add lines.
        yield* run(
          `INSERT INTO unit (${UNIT_COLUMNS.join(", ")}) VALUES ${placeholderRows(batch.length, UNIT_COLUMNS.length)} ON CONFLICT (source_id, unit_key, session_id) DO UPDATE SET
            input = coalesce(max(input, excluded.input), input, excluded.input),
            cache_read = coalesce(max(cache_read, excluded.cache_read), cache_read, excluded.cache_read),
            cache_write_5m = coalesce(max(cache_write_5m, excluded.cache_write_5m), cache_write_5m, excluded.cache_write_5m),
            cache_write_1h = coalesce(max(cache_write_1h, excluded.cache_write_1h), cache_write_1h, excluded.cache_write_1h),
            output = coalesce(max(output, excluded.output), output, excluded.output)`,
          ...params,
        );
        if (!changes.rebuild)
          yield* run(
            `INSERT OR IGNORE INTO touched (unit_key) VALUES ${placeholderRows(batch.length, 1)}`,
            ...keys,
          );
      }
    });

  /** Removes the units of a source. Their keys and slots get a new rollup. */
  const dropUnits = (changes: UsageReadChanges, sourceId: number) =>
    Effect.gen(function* () {
      if (!changes.rebuild) {
        yield* run(
          "INSERT OR IGNORE INTO touched (unit_key) SELECT unit_key FROM unit WHERE source_id = ?",
          sourceId,
        );
        const rows = yield* values(
          `SELECT DISTINCT occurred_at_ms / ${USAGE_SLOT_MS} FROM unit WHERE source_id = ?`,
          sourceId,
        );
        for (const row of rows) changes.removedSlots.add(num(row[0]));
      }
      yield* run("DELETE FROM unit WHERE source_id = ?", sourceId);
    });

  const storedIssue = (sourceId: number) =>
    values(
      "SELECT issue_code, issue_first_ms, issue_last_ms FROM source WHERE id = ?",
      sourceId,
    ).pipe(
      Effect.map(([row]): UsageSourceIssue | null =>
        row && row[0] !== null && row[0] !== undefined
          ? {
              code: issueCodeOf(row[0]),
              firstAtMs: nullableNum(row[1]),
              lastAtMs: nullableNum(row[2]),
            }
          : null,
      ),
    );

  const applySource = (changes: UsageReadChanges, update: UsageSourceUpdate) =>
    Effect.gen(function* () {
      const existing = yield* values("SELECT id FROM source WHERE path = ?", update.path);
      let sourceId = nullableNum(existing[0]?.[0]);
      if (sourceId !== null && update.mode === "replace") yield* dropUnits(changes, sourceId);
      const issue =
        sourceId !== null && update.mode === "append"
          ? mergeAppendIssue(yield* storedIssue(sourceId), update.issue)
          : update.issue;
      const fields: SqliteValue[] = [
        update.runtime,
        update.path,
        update.fingerprint.size,
        update.fingerprint.modifiedAtMs,
        update.fingerprint.fileId,
        update.resume?.offset ?? null,
        update.resume?.digest ?? null,
        update.parserState,
        issue?.code ?? null,
        issue?.firstAtMs ?? null,
        issue?.lastAtMs ?? null,
      ];
      if (sourceId === null) {
        const result = yield* run(
          "INSERT INTO source (runtime, path, size, modified_at_ms, file_id, resume_offset, resume_digest, parser_state, issue_code, issue_first_ms, issue_last_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ...fields,
        );
        sourceId = Number(result.lastInsertRowid);
      } else {
        yield* run(
          "UPDATE source SET runtime = ?, path = ?, size = ?, modified_at_ms = ?, file_id = ?, resume_offset = ?, resume_digest = ?, parser_state = ?, issue_code = ?, issue_first_ms = ?, issue_last_ms = ? WHERE id = ?",
          ...fields,
          sourceId,
        );
      }
      yield* insertUnits(changes, sourceId, update.runtime, update.units);
    });

  const sources = () =>
    Effect.gen(function* () {
      const rows = yield* values(
        "SELECT id, runtime, path, size, modified_at_ms, file_id, resume_offset, resume_digest, parser_state, issue_code FROM source",
      );
      return rows.map((row): UsageSourceRow => {
        const resumeOffset = nullableNum(row[6]);
        return {
          id: num(row[0]),
          runtime: runtimeOf(row[1]),
          path: str(row[2]),
          fingerprint: { size: num(row[3]), modifiedAtMs: num(row[4]), fileId: str(row[5]) },
          resume:
            resumeOffset === null || row[7] === null
              ? null
              : { offset: resumeOffset, digest: str(row[7]) },
          parserState: row[8] === null ? null : str(row[8]),
          unreadable: row[9] === "unreadable",
        };
      });
    });

  return { applySource, dropUnits, sources };
};
