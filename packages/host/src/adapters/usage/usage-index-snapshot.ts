import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import type { UsageDate, UsagePeriodBounds } from "../../domain/usage/usage-calendar";
import type { UsageAggregate, UsageIssueRow } from "../../domain/usage/usage-report";
import type { SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";
import {
  type IndexQueries,
  issueCodeOf,
  nullableNum,
  nullableStr,
  num,
  placeholderRows,
  runtimeOf,
  str,
  SUM_COLUMNS,
  sumsAt,
} from "./usage-index-rows";

/** The dates and runtimes of a report. */
export type UsageSnapshotScope = {
  start: UsageDate;
  end: UsageDate;
  runtimes: readonly RuntimeKind[];
};

/** A recorded folder of the rollup, or null for activity without a folder. */
export type UsageProjectFolder = { projectId: number; folder: string | null };

/** Rows per insert, within the SQL parameter limit. */
const ROWS_PER_INSERT = 300;

/** The filter of a scope, on the `day` table as `d`. */
const filterOf = (scope: UsageSnapshotScope) => {
  const params: SqliteValue[] = [scope.start, scope.end, ...scope.runtimes];
  const runtimes = scope.runtimes.map(() => "?").join(", ");
  return { where: `d.local_date BETWEEN ? AND ? AND d.runtime IN (${runtimes})`, params };
};

/**
 * Reads the figures of the index after its rollup is up to date. It runs in the transaction of a
 * read, so all of its queries see one snapshot.
 */
export const createUsageIndexSnapshot = ({ values, run }: IndexQueries) => {
  /** Inserts rows into a temporary table in batches, so no insert exceeds the parameter limit. */
  const fill = (table: string, columns: readonly string[], rows: readonly SqliteValue[][]) =>
    Effect.gen(function* () {
      yield* run(`DELETE FROM ${table}`);
      for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
        const batch = rows.slice(start, start + ROWS_PER_INSERT);
        yield* run(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholderRows(batch.length, columns.length)}`,
          ...batch.flat(),
        );
      }
    });

  return {
    /** The earliest activity date of each runtime with activity. */
    earliestDates: () =>
      Effect.gen(function* () {
        const dates: Partial<Record<RuntimeKind, UsageDate>> = {};
        for (const row of yield* values(
          "SELECT runtime, MIN(local_date) FROM day GROUP BY runtime",
        ))
          dates[runtimeOf(row[0])] = str(row[1]);
        return dates;
      }),

    /** The issues of the stored sources. */
    issues: () =>
      values(
        "SELECT runtime, issue_code, issue_first_ms, issue_last_ms FROM source WHERE issue_code IS NOT NULL",
      ).pipe(
        Effect.map((rows) =>
          rows.map((row): UsageIssueRow => ({
            runtime: runtimeOf(row[0]),
            scope: "source",
            code: issueCodeOf(row[1]),
            firstAtMs: nullableNum(row[2]),
            lastAtMs: nullableNum(row[3]),
          })),
        ),
      ),

    /** The recorded folders with activity in the scope. */
    projectFolders: (scope: UsageSnapshotScope) => {
      const { where, params } = filterOf(scope);
      return values(
        `SELECT d.project_id, n.value FROM day d LEFT JOIN name n ON n.id = d.project_id
   WHERE ${where} GROUP BY d.project_id`,
        ...params,
      ).pipe(
        Effect.map((rows) =>
          rows.map((row): UsageProjectFolder => ({
            projectId: num(row[0]),
            folder: nullableStr(row[1]),
          })),
        ),
      );
    },

    /**
     * Sums the daily rollup of the scope by runtime, period, model, and project group. Each
     * project of `projectFolders` needs its group key in `projectGroups`.
     */
    aggregate: (
      input: UsageSnapshotScope & {
        periods: readonly UsagePeriodBounds[];
        projectGroups: readonly { projectId: number; group: string }[];
      },
    ) =>
      Effect.gen(function* () {
        const { where, params } = filterOf(input);
        const byRuntime = (yield* values(
          `SELECT d.runtime, ${SUM_COLUMNS} FROM day d WHERE ${where} GROUP BY d.runtime`,
          ...params,
        )).map((row) => ({ runtime: runtimeOf(row[0]), ...sumsAt(row, 1) }));

        // Sessions are distinct inside a period, so the periods sum in SQL and not from days.
        yield* fill(
          "report_period",
          ["idx", "start", "end"],
          input.periods.map((period, index) => [index, period.start, period.end]),
        );
        const periods = (yield* values(
          `SELECT p.idx, d.runtime, ${SUM_COLUMNS} FROM day d
   JOIN report_period p ON d.local_date BETWEEN p.start AND p.end
   WHERE ${where} GROUP BY p.idx, d.runtime`,
          ...params,
        )).map((row) => ({ period: num(row[0]), runtime: runtimeOf(row[1]), ...sumsAt(row, 2) }));

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

        yield* fill(
          "project_group",
          ["project_id", "group_key"],
          input.projectGroups.map(({ projectId, group }) => [projectId, group]),
        );
        // Session names carry their runtime, so distinct sessions of a group need no runtime split.
        const byProject = (yield* values(
          `SELECT g.group_key, ${SUM_COLUMNS} FROM day d
   JOIN project_group g USING (project_id) WHERE ${where}
   GROUP BY g.group_key`,
          ...params,
        )).map((row) => ({ group: str(row[0]), ...sumsAt(row, 1) }));
        return { byRuntime, periods, byModel, byProject } satisfies UsageAggregate;
      }),
  };
};

export type UsageIndexSnapshot = ReturnType<typeof createUsageIndexSnapshot>;
