import {
  knownRuntimeKindValues,
  type RuntimeKind,
  type UsageCoverageIssue,
  type UsageReport,
  type UsageReportReadInput,
  type UsageRuntimeCoverage,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  addDays,
  createUsageCalendar,
  type UsageCalendar,
  type UsageDate,
} from "../../domain/usage/usage-calendar";
import {
  addUsageSums,
  EMPTY_USAGE_SUMS,
  type UsageSums,
  usageFigure,
} from "../../domain/usage/usage-figure";
import { usageProjectLabels, usageStableId } from "../../domain/usage/usage-projects";
import {
  type UsageWorkspaceFolders,
  usageWorkspaceFolders,
  workspacesWithSharedWorktrees,
} from "../../domain/usage/usage-workspace-folders";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { managedWorktreeBaseForRepoConfig } from "../git/managed-worktree-roots";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskOwnershipReader, TaskStoreError } from "../../ports/task-repository-ports";
import type {
  UsageIndexPort,
  UsageIssueRow,
  UsageLocations,
  UsageSumRow,
} from "../../ports/usage-index-port";

export type UsageReportServiceDependencies = {
  index: UsageIndexPort;
  settingsConfig: Pick<
    SettingsConfigPort,
    "readWorkspaceCatalogSnapshot" | "defaultWorktreeBasePath" | "resolveConfiguredPath" | "join"
  >;
  /** The tasks of workspaces in any state. They own their worktrees in a shared folder. */
  taskOwnership: Pick<TaskOwnershipReader, "listTaskDirectoriesForWorktreeOwnership">;
  /** The history folders of each runtime, from the environment of the login shell. */
  locations: () => UsageLocations;
  timeZone: () => string;
  now: () => number;
};

/** A recent range ends today and counts today. */
const RECENT_RANGE_DAYS = { last_7_days: 7, last_30_days: 30, last_90_days: 90 } as const;

const RUNTIME_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<RuntimeKind, string>;

/** Instants `[start, end)` of a date range. */
type Span = { startMs: number; endMs: number };

const spanOf = (calendar: UsageCalendar, start: UsageDate, end: UsageDate): Span => ({
  startMs: calendar.startOf(start),
  endMs: calendar.startOf(addDays(end, 1)),
});

/** An issue without known dates covers every date. */
const overlaps = (issue: Pick<UsageIssueRow, "firstAtMs" | "lastAtMs">, span: Span): boolean =>
  issue.firstAtMs === null ||
  issue.lastAtMs === null ||
  (issue.firstAtMs < span.endMs && issue.lastAtMs >= span.startMs);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const coverageIssues = (
  runtime: RuntimeKind,
  issues: readonly UsageIssueRow[],
  locationUnreadable: boolean,
): UsageCoverageIssue[] => {
  const name = RUNTIME_NAMES[runtime];
  const result: UsageCoverageIssue[] = [];
  if (locationUnreadable)
    result.push({
      code: "unreadable",
      message: `OpenDucktor cannot read some ${name} history folders or files. Usage shows the history that it can read.`,
      nextAction: `Give your user account read access to the ${name} history folders, then select Refresh.`,
    });
  const count = (code: UsageIssueRow["code"]) =>
    issues.filter((issue) => issue.code === code).length;
  const unreadable = count("unreadable");
  if (unreadable > 0)
    result.push({
      code: "unreadable",
      message: `OpenDucktor cannot read ${plural(unreadable, "file")} of the ${name} history.`,
      nextAction: `Give your user account read access to the ${name} history files, then select Refresh.`,
    });
  const malformed = count("malformed_records");
  if (malformed > 0)
    result.push({
      code: "malformed_records",
      message: `${plural(malformed, "file")} of the ${name} history ${malformed === 1 ? "has" : "have"} records that OpenDucktor cannot parse or attribute to one session. The figures leave those records out.`,
      nextAction: null,
    });
  if (count("unsupported_format") > 0)
    result.push({
      code: "unsupported_format",
      message: `${name} stores its history in a format that this OpenDucktor version cannot read.`,
      nextAction: "Update OpenDucktor, then select Refresh.",
    });
  return result;
};

const sumsByRuntime = (rows: readonly UsageSumRow[]) => {
  const sums = new Map<RuntimeKind, UsageSums>();
  for (const { runtime, ...row } of rows)
    sums.set(runtime, addUsageSums(sums.get(runtime) ?? EMPTY_USAGE_SUMS, row));
  return sums;
};

const sumOf = (rows: readonly UsageSumRow[]): UsageSums =>
  rows.reduce<UsageSums>(
    (total, { runtime: _runtime, ...row }) => addUsageSums(total, row),
    EMPTY_USAGE_SUMS,
  );

const byProcessed = <
  Row extends { figure: { tokens: { processed: number }; cost: { usd: number } } },
>(
  left: Row,
  right: Row,
) =>
  right.figure.tokens.processed - left.figure.tokens.processed ||
  right.figure.cost.usd - left.figure.cost.usd;

/** Reads the workspaces and, for shared worktree folders, the tasks that own their worktrees. */
const workspaceFoldersOf = ({
  settingsConfig,
  taskOwnership,
}: UsageReportServiceDependencies): Effect.Effect<
  UsageWorkspaceFolders,
  SettingsConfigError | TaskStoreError
> =>
  Effect.gen(function* () {
    const catalog = yield* settingsConfig.readWorkspaceCatalogSnapshot();
    const workspaces = catalog.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      name: workspace.workspaceName,
      repoPath: workspace.repoPath,
      worktreeBase: managedWorktreeBaseForRepoConfig(settingsConfig, workspace),
    }));
    const sharing = workspacesWithSharedWorktrees(workspaces);
    // The administrative read admits every workspace and task state, also a closed workspace.
    const tasks =
      sharing.length === 0
        ? []
        : yield* taskOwnership.listTaskDirectoriesForWorktreeOwnership({ workspaces: sharing });
    return usageWorkspaceFolders(workspaces, tasks, settingsConfig.join);
  });

/** Builds the usage report of one selection from the usage index. */
export const createUsageReportService = (dependencies: UsageReportServiceDependencies) => ({
  read: (
    input: UsageReportReadInput,
  ): Effect.Effect<
    UsageReport,
    HostOperationErrorAggregate | SettingsConfigError | TaskStoreError
  > =>
    Effect.gen(function* () {
      const timeZone = dependencies.timeZone();
      const calendar = createUsageCalendar(timeZone);
      const today = calendar.dateOf(dependencies.now());
      const runtimes: RuntimeKind[] = input.runtime ? [input.runtime] : [...knownRuntimeKindValues];
      const range = input.range;
      const fixedStart =
        range.kind === "custom"
          ? range.start
          : range.kind === "all_time"
            ? null
            : addDays(today, 1 - RECENT_RANGE_DAYS[range.kind]);
      // The check and the figures come from one worker read on one snapshot of the index.
      const result = yield* dependencies.index.read({
        timeZone,
        locations: dependencies.locations(),
        runtimes,
        range: { start: fixedStart, end: range.kind === "custom" ? range.end : today },
        refresh: input.refresh ?? false,
        ...(yield* workspaceFoldersOf(dependencies)),
      });
      const { start, end } = result.range;
      const { granularity, periodBounds: periods } = result;

      const rangeSpan = spanOf(calendar, start, end);
      const issuesOf = (runtime: RuntimeKind, span: Span) =>
        result.issues.filter((issue) => issue.runtime === runtime && overlaps(issue, span));
      const unreadableLocation = (runtime: RuntimeKind) =>
        result.locationIssues.some((issue) => issue.runtime === runtime);
      const completeIn = (runtime: RuntimeKind, span: Span) =>
        !unreadableLocation(runtime) && issuesOf(runtime, span).length === 0;
      const rangeComplete = new Map(
        runtimes.map((runtime) => [runtime, completeIn(runtime, rangeSpan)]),
      );
      const allComplete = runtimes.every((runtime) => rangeComplete.get(runtime));

      const runtimeSums = sumsByRuntime(result.byRuntime);
      const byRuntime = runtimes.map((runtime) => ({
        runtime,
        figure: usageFigure(
          runtimeSums.get(runtime) ?? EMPTY_USAGE_SUMS,
          rangeComplete.get(runtime) ?? true,
        ),
      }));

      const periodRows = new Map<string, UsageSums>();
      for (const { period, runtime, ...row } of result.periods)
        periodRows.set(`${period}:${runtime}`, row);
      const reportPeriods = periods.map((period, index) => {
        const span = spanOf(calendar, period.start, period.end);
        return {
          start: period.start,
          end: period.end,
          runtimes: runtimes.map((runtime) => ({
            runtime,
            figure: usageFigure(
              periodRows.get(`${index}:${runtime}`) ?? EMPTY_USAGE_SUMS,
              completeIn(runtime, span),
            ),
          })),
        };
      });

      const models = new Map<
        string,
        { provider: string | null; model: string | null; rows: UsageSumRow[] }
      >();
      for (const row of result.byModel) {
        const key = `${row.provider ?? ""}\u0000${row.model ?? ""}`;
        const entry = models.get(key) ?? { provider: row.provider, model: row.model, rows: [] };
        entry.rows.push(row);
        models.set(key, entry);
      }
      const byModel = [...models.entries()]
        .map(([key, entry]) => ({
          id: usageStableId(key),
          provider: entry.provider,
          model: entry.model,
          figure: usageFigure(
            sumOf(entry.rows),
            entry.rows.every((row) => rangeComplete.get(row.runtime)),
          ),
        }))
        .sort(byProcessed);

      const labels = usageProjectLabels(result.projects);
      const byProject = result.byProject
        .map(({ group, ...sums }) => ({
          id: usageStableId(group),
          label: labels.get(group) ?? null,
          figure: usageFigure(sums, allComplete),
        }))
        .sort(byProcessed);

      const coverage = runtimes.map((runtime): UsageRuntimeCoverage => {
        const issues = coverageIssues(
          runtime,
          issuesOf(runtime, rangeSpan),
          unreadableLocation(runtime),
        );
        return {
          runtime,
          state:
            issues.length > 0
              ? "partial"
              : result.withoutHistory.includes(runtime)
                ? "no_history"
                : "complete",
          issues,
        };
      });

      return {
        timeZone,
        range: { start, end },
        granularity,
        resultAt: new Date(result.resultAtMs).toISOString(),
        pricing: {
          source: result.pricing.source,
          updatedAt:
            result.pricing.updatedAtMs === null
              ? null
              : new Date(result.pricing.updatedAtMs).toISOString(),
          issue: result.pricing.issue,
        },
        totals: usageFigure(sumOf(result.byRuntime), allComplete),
        periods: reportPeriods,
        byRuntime,
        byModel,
        byProject,
        coverage,
      } satisfies UsageReport;
    }),
});

export type UsageReportService = ReturnType<typeof createUsageReportService>;
