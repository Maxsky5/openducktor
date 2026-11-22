import type { RuntimeKind } from "@openducktor/contracts";
import { runtimeKindSchema, usageIssueCodeSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { UsageDate } from "../../domain/usage/usage-calendar";
import type { UsageSums } from "../../domain/usage/usage-figure";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";
import type { SqliteRunResult } from "../../infrastructure/sqlite/sqlite-driver-values";
import type { UsageAggregate, UsageSourceIssue } from "../../ports/usage-index-port";

export type UsageAggregateInput = {
  start: UsageDate;
  end: UsageDate;
  runtimes: readonly RuntimeKind[];
  periods: readonly { start: UsageDate; end: UsageDate }[];
  /** The project of each recorded folder. */
  /** The project key of each recorded folder, in the same order. */
  groupProjects: (paths: readonly (string | null)[]) => string[];
};

export const num = (value: SqliteValue | undefined): number => (value === null ? 0 : Number(value));
export const nullableNum = (value: SqliteValue | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);
export const str = (value: SqliteValue | undefined): string => String(value);
const nullableStr = (value: SqliteValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** The index stores only runtime kinds and issue codes that it wrote itself. */
export const runtimeOf = (value: SqliteValue | undefined): RuntimeKind =>
  runtimeKindSchema.parse(value);
export const issueCodeOf = (value: SqliteValue | undefined): UsageSourceIssue["code"] =>
  usageIssueCodeSchema.parse(value);

const PERIODS_PER_INSERT = 300;

const SUM_COLUMNS = `SUM(input), SUM(cache_read), SUM(cache_write), SUM(output), SUM(unmeasured),
  SUM(unpriced_tokens), TOTAL(cost_usd), COUNT(DISTINCT session_id)`;

/** The 8 sum columns that start at `offset`. */
const sumsAt = (row: SqliteValue[], offset: number): UsageSums => ({
  input: num(row[offset]),
  cacheRead: num(row[offset + 1]),
  cacheWrite: num(row[offset + 2]),
  output: num(row[offset + 3]),
  unmeasured: num(row[offset + 4]),
  unpricedTokens: num(row[offset + 5]),
  costUsd: num(row[offset + 6]),
  sessions: num(row[offset + 7]),
});

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

/** Sums the daily rollup of one selection by runtime, period, model, and project. */
export const aggregateUsage = ({ values, run }: IndexQueries, input: UsageAggregateInput) =>
  Effect.gen(function* () {
    const runtimeList = input.runtimes.map(() => "?").join(", ");
    const where = `local_date BETWEEN ? AND ? AND runtime IN (${runtimeList})`;
    const params: SqliteValue[] = [input.start, input.end, ...input.runtimes];
    const byRuntime = (yield* values(
      `SELECT runtime, ${SUM_COLUMNS} FROM day WHERE ${where} GROUP BY runtime`,
      ...params,
    )).map((row) => ({ runtime: runtimeOf(row[0]), ...sumsAt(row, 1) }));

    // Periods go through a table in batches, so no range exceeds the SQL parameter limit.
    yield* run("DELETE FROM report_period");
    for (let start = 0; start < input.periods.length; start += PERIODS_PER_INSERT) {
      const batch = input.periods.slice(start, start + PERIODS_PER_INSERT);
      yield* run(
        `INSERT INTO report_period VALUES ${batch.map(() => "(?, ?, ?)").join(", ")}`,
        ...batch.flatMap((period, index) => [start + index, period.start, period.end]),
      );
    }
    const periods = (yield* values(
      `SELECT p.idx, d.runtime, ${SUM_COLUMNS} FROM day d
   JOIN report_period p ON d.local_date BETWEEN p.start AND p.end
   WHERE ${where} GROUP BY p.idx, d.runtime`,
      ...params,
    )).map((row) => ({
      period: num(row[0]),
      runtime: runtimeOf(row[1]),
      ...sumsAt(row, 2),
    }));

    // Names come from the same snapshot as the rollup, so names that another host added resolve.
    const byModel = (yield* values(
      `SELECT d.runtime, pn.value, mn.value, ${SUM_COLUMNS} FROM day d
   LEFT JOIN name pn ON pn.id = d.provider_id LEFT JOIN name mn ON mn.id = d.model_id
   WHERE ${where} GROUP BY d.runtime, d.provider_id, d.model_id`,
      ...params,
    )).map((row) => ({
      runtime: runtimeOf(row[0]),
      provider: nullableStr(row[1]),
      model: nullableStr(row[2]),
      ...sumsAt(row, 3),
    }));

    yield* run("DELETE FROM project_group");
    const projects = yield* values(
      `SELECT d.project_id, n.value FROM day d LEFT JOIN name n ON n.id = d.project_id
   WHERE ${where} GROUP BY d.project_id`,
      ...params,
    );
    const keys = input.groupProjects(projects.map((row) => nullableStr(row[1])));
    for (const [index, row] of projects.entries()) {
      const key = keys[index];
      if (key === undefined) throw new Error("A recorded project folder has no project.");
      yield* run("INSERT INTO project_group VALUES (?, ?)", num(row[0]), key);
    }
    // Session names carry their runtime, so distinct sessions of a group need no runtime split.
    const byProject = (yield* values(
      `SELECT g.group_key, ${SUM_COLUMNS} FROM day d
   JOIN project_group g USING (project_id) WHERE ${where}
   GROUP BY g.group_key`,
      ...params,
    )).map((row) => ({ group: str(row[0]), ...sumsAt(row, 1) }));
    return { byRuntime, periods, byModel, byProject } satisfies UsageAggregate;
  });
