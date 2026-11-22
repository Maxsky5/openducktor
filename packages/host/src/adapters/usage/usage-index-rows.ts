import type { RuntimeKind } from "@openducktor/contracts";
import { runtimeKindSchema, usageIssueCodeSchema } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { UsageSums } from "../../domain/usage/usage-figure";
import type { UsageSourceIssue } from "../../domain/usage/usage-report";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";
import type { SqliteRunResult } from "../../infrastructure/sqlite/sqlite-driver-values";

export const num = (value: SqliteValue | undefined): number => (value === null ? 0 : Number(value));
export const nullableNum = (value: SqliteValue | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);
export const str = (value: SqliteValue | undefined): string => String(value);
export const nullableStr = (value: SqliteValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** The index stores only runtime kinds and issue codes that it wrote itself. */
export const runtimeOf = (value: SqliteValue | undefined): RuntimeKind =>
  runtimeKindSchema.parse(value);
export const issueCodeOf = (value: SqliteValue | undefined): UsageSourceIssue["code"] =>
  usageIssueCodeSchema.parse(value);

/** The 8 sum columns of a rollup query. `sumsAt` reads them. */
export const SUM_COLUMNS = `SUM(input), SUM(cache_read), SUM(cache_write), SUM(output), SUM(unmeasured),
  SUM(unpriced_tokens), TOTAL(cost_usd), COUNT(DISTINCT session_id)`;

/** The 8 sum columns of `SUM_COLUMNS` that start at `offset`. */
export const sumsAt = (row: SqliteValue[], offset: number): UsageSums => ({
  input: num(row[offset]),
  cacheRead: num(row[offset + 1]),
  cacheWrite: num(row[offset + 2]),
  output: num(row[offset + 3]),
  unmeasured: num(row[offset + 4]),
  unpricedTokens: num(row[offset + 5]),
  costUsd: num(row[offset + 6]),
  sessions: num(row[offset + 7]),
});

/** `count` rows of `columns` placeholders, for one insert of many rows. */
export const placeholderRows = (count: number, columns: number): string => {
  const row = `(${Array.from({ length: columns }, () => "?").join(", ")})`;
  return Array.from({ length: count }, () => row).join(", ");
};

/** The SQL helpers of one index connection. */
export type IndexQueries = {
  values(
    sql: string,
    ...params: SqliteValue[]
  ): Effect.Effect<SqliteValue[][], HostOperationErrorAggregate>;
  run(
    sql: string,
    ...params: SqliteValue[]
  ): Effect.Effect<SqliteRunResult, HostOperationErrorAggregate>;
};
