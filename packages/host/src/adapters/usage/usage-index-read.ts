import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
import type { UsageIndexProgress } from "@openducktor/contracts";
import { Effect } from "effect";
import { createUsageCalendar, usageReportPeriods } from "../../domain/usage/usage-calendar";
import {
  createUsageProjectGrouping,
  type UsageProjectGroup,
} from "../../domain/usage/usage-projects";
import type { UsageIndexFigures } from "../../domain/usage/usage-report";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { UsageIndexSnapshot } from "./usage-index-snapshot";
import type { UsageIndexStore, UsageIndexWriter } from "./usage-index-store";
import { createUsageProgressTracker } from "./usage-index-progress";
import type { UsageParsePool, UsageParserFault } from "./usage-parse-pool";
import { USAGE_RATES_SOURCE, type UsagePricing } from "./usage-rate-catalog";
import { createUsageRepositoryResolver } from "./usage-repositories";
import { type Discovery, discoverUsageSources } from "./usage-source-discovery";
import { readCodexSessions } from "./usage-source-sessions";
import { planUsageSync } from "./usage-sync-plan";
import type { UsageIndexReadInput } from "./usage-worker-protocol";

/** The runtimes and the range start that a source check covered. */
type CheckScope = { runtimes: readonly RuntimeKind[]; sinceMs: number | null };

type Synced = {
  discovery: Discovery;
  checkedAtMs: number;
  scope: CheckScope;
  /** True when a cancel stopped the parse before every source of the check was claimed. */
  stopped: boolean;
};

/** A read of a new selection uses the check of an earlier read of these last minutes. */
const CHECK_REUSE_MS = 5 * 60_000;

/** True for a check of all runtimes from the first record. */
const coversAllHistory = ({ runtimes, sinceMs }: CheckScope): boolean =>
  sinceMs === null && runtimes.length === knownRuntimeKindValues.length;

/**
 * The last complete source check. A read of another range or runtime answers from the index
 * with it while it is recent, unless the user asks for a refresh: a check stats every source and
 * digests a changed OpenCode database, which takes from 0.1 s to about 1 s.
 */
export const createUsageCheckMemo = (now: () => number = Date.now) => {
  let last: Synced | null = null;
  // True once the index holds all history: a check of all runtimes from the first record.
  let complete = false;
  return {
    record: (synced: Synced) => {
      if (synced.stopped) return;
      last = synced;
      if (coversAllHistory(synced.scope)) complete = true;
    },
    /** The last check when it is recent and covers the runtimes and the range of a read. */
    reusable: ({ runtimes, sinceMs }: CheckScope): Synced | null => {
      if (!last || now() - last.checkedAtMs >= CHECK_REUSE_MS) return null;
      const { scope } = last;
      if (!runtimes.every((runtime) => scope.runtimes.includes(runtime))) return null;
      const coversRange =
        complete || scope.sinceMs === null || (sinceMs !== null && sinceMs >= scope.sinceMs);
      return coversRange ? last : null;
    },
    /**
     * True when a read of `scope` skipped history that the index does not hold yet: sources
     * before its range, or sources of other runtimes. An older source that changes gets a recent
     * modification time, so one complete check is enough.
     */
    needsCatchUp: (scope: CheckScope): boolean => !complete && !coversAllHistory(scope),
  };
};

export type UsageProgressListener = (progress: UsageIndexProgress) => void;

type UsageReadError = HostOperationErrorAggregate | UsageParserFault;

/**
 * Removes the sources that left the disk and commits the parse of each new or changed one. A read
 * that parses sources reports its progress to `onProgress`, and returns its progress tracker.
 */
const syncSources = ({
  writer,
  pool,
  input,
  sinceMs,
  first,
  isCancelled,
  onProgress,
}: {
  writer: UsageIndexWriter;
  pool: UsageParsePool;
  input: UsageIndexReadInput;
  sinceMs: number | null;
  /** A first read of an empty index. */
  first: boolean;
  isCancelled: () => boolean;
  onProgress: UsageProgressListener | null;
}) =>
  Effect.gen(function* () {
    const checkedAtMs = Date.now();
    // The first read of an empty index reads all history, as the page tells the user. A range or
    // runtime that the user picks during it then finds its history read, and adds no work.
    const scope: CheckScope = first
      ? { runtimes: knownRuntimeKindValues, sinceMs: null }
      : { runtimes: input.runtimes, sinceMs };
    const discovery = discoverUsageSources(input.locations, scope.runtimes);
    const plan = planUsageSync({
      runtimes: scope.runtimes,
      onDisk: discovery.sources,
      unreadablePaths: discovery.unreadablePaths,
      stored: yield* writer.sources(),
      sinceMs: scope.sinceMs,
    });
    for (const sourceId of plan.removeIds) yield* writer.removeSource(sourceId);
    // Every later read needs the history of a first read, so a first read never stops early.
    const stopsEarly = first ? () => false : isCancelled;
    const progress =
      onProgress && plan.jobs.length > 0
        ? createUsageProgressTracker(plan.jobs, first, onProgress)
        : null;
    const parse = pool.run({
      jobs: plan.jobs,
      commit: (jobIndex, job, result) =>
        writer
          .applySource({
            runtime: job.runtime,
            path: job.path,
            fingerprint: job.fingerprint,
            resume: result.resume,
            parserState: result.parserState,
            issue: result.issue,
            mode: result.mode,
            units: result.units,
          })
          .pipe(Effect.tap(() => Effect.sync(() => progress?.finished(jobIndex)))),
      isCancelled: stopsEarly,
      onProgress: (jobIndex, inside) => progress?.inside(jobIndex, inside),
    });
    // The root sessions of Codex rollouts come from their first lines, read beside the parse.
    if (progress)
      yield* Effect.all([parse, readCodexSessions(plan.jobs, progress.sessionOf)], {
        concurrency: "unbounded",
        discard: true,
      });
    else yield* parse;
    progress?.summarizing();
    const synced: Synced = {
      discovery,
      checkedAtMs,
      scope,
      stopped: !first && isCancelled(),
    };
    return { synced, progress };
  });

/** The figures of the range, the issues, and the project groups of the recorded folders. */
const reportOf = ({
  repositories,
  snapshot,
  input,
  pricing,
  synced: { discovery, checkedAtMs },
}: {
  repositories: ReturnType<typeof createUsageRepositoryResolver>;
  snapshot: UsageIndexSnapshot;
  input: UsageIndexReadInput;
  pricing: UsagePricing;
  synced: Synced;
}): Effect.Effect<UsageIndexFigures, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const { range, granularity, periods } = usageReportPeriods(
      input.range,
      yield* snapshot.earliestDates(),
      input.runtimes,
    );
    const scope = { ...range, runtimes: input.runtimes };
    // Git names the repository of each recorded folder, between the queries of the snapshot.
    const folders = yield* snapshot.projectFolders(scope);
    const grouping = createUsageProjectGrouping(
      input.workspaces,
      input.separateFolders,
      repositories(
        folders.flatMap(({ folder }) => (folder === null ? [] : [folder])),
        input.workspaces.map((workspace) => workspace.repoPath),
      ),
    );
    const groups = new Map<string, UsageProjectGroup>();
    const projectGroups = folders.map(({ projectId, folder }) => {
      const group = grouping(folder);
      groups.set(group.key, group);
      return { projectId, group: group.key };
    });
    const aggregate = yield* snapshot.aggregate({ ...scope, periods, projectGroups });
    const locationIssues = discovery.unreadableRuntimes.map((runtime) => ({
      runtime,
      scope: "location" as const,
      code: "unreadable" as const,
      firstAtMs: null,
      lastAtMs: null,
    }));
    return {
      ...aggregate,
      range,
      granularity,
      periodBounds: periods,
      issues: [...locationIssues, ...(yield* snapshot.issues())],
      resultAtMs: checkedAtMs,
      withoutHistory: discovery.withoutHistory,
      projects: [...groups.values()],
      pricing: {
        source: USAGE_RATES_SOURCE,
        updatedAtMs: pricing.updatedAtMs,
        failure: pricing.failure,
      },
    };
  });

/**
 * Reads the usage index for the index worker. It keeps the parse pool, the git data of the
 * recorded folders, and the last source check between reads.
 */
export const createUsageIndexReader = ({
  store,
  pool,
}: {
  store: UsageIndexStore;
  pool: UsageParsePool;
}) => {
  /** Resolves recorded folders to repositories, and keeps what it learned from the disk. */
  const repositories = createUsageRepositoryResolver();
  const checks = createUsageCheckMemo();
  const sinceOf = (input: UsageIndexReadInput): number | null =>
    input.range.start === null
      ? null
      : createUsageCalendar(input.timeZone).startOf(input.range.start);

  return {
    /** True when the index holds no source yet, so the next read is a first read. */
    isFirstRead: (): Effect.Effect<boolean, HostOperationErrorAggregate> => store.isEmpty(),

    /** Stops the parse of the active read from claiming more jobs when it is canceled. */
    stopParsing: () => pool.stop(),

    /** True when a read of `input` skipped history that a catch-up must parse. */
    needsCatchUp: (input: UsageIndexReadInput): boolean =>
      checks.needsCatchUp({ runtimes: input.runtimes, sinceMs: sinceOf(input) }),

    /**
     * Checks the sources of the range and its runtimes, rolls them up, and reads the report
     * figures in one write transaction of the index. A read of a new selection can use a recent
     * check of an earlier read instead. A canceled read stops new parses, and still commits the
     * sources that its parsers finished, with their rollup.
     */
    read: ({
      input,
      pricing,
      first,
      isCancelled,
      onProgress,
    }: {
      input: UsageIndexReadInput;
      pricing: UsagePricing;
      /** A first read of an empty index, from `isFirstRead`. */
      first: boolean;
      isCancelled: () => boolean;
      onProgress: UsageProgressListener;
    }): Effect.Effect<UsageIndexFigures, UsageReadError> => {
      const sinceMs = sinceOf(input);
      const reused = input.refresh ? null : checks.reusable({ runtimes: input.runtimes, sinceMs });
      let progress: ReturnType<typeof createUsageProgressTracker> | null = null;
      let checked: Synced | null = null;
      return store
        .read({
          calendar: createUsageCalendar(input.timeZone),
          pricer: pricing.pricer,
          sync: (writer) =>
            reused
              ? Effect.succeed(reused)
              : syncSources({
                  writer,
                  pool,
                  input,
                  sinceMs,
                  first,
                  isCancelled,
                  onProgress,
                }).pipe(
                  Effect.map((result) => {
                    progress = result.progress;
                    checked = result.synced;
                    return result.synced;
                  }),
                ),
          report: (snapshot, synced) =>
            reportOf({ repositories, snapshot, input, pricing, synced }),
          onRollup: (fraction) => progress?.rollup(fraction),
          // A check counts only once its sources commit: a failed transaction rolls them back.
        })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (checked) checks.record(checked);
            }),
          ),
        );
    },

    /**
     * Parses the history that a read skipped: sources before its range and sources of other
     * runtimes. A later read of another range or runtime then finds its history parsed. It stops
     * claiming parse jobs as soon as `isStopped` returns true; jobs in progress still commit.
     */
    catchUp: ({
      input,
      pricing,
      isStopped,
    }: {
      input: UsageIndexReadInput;
      pricing: UsagePricing;
      isStopped: () => boolean;
    }): Effect.Effect<void, UsageReadError> => {
      let checked: Synced | null = null;
      return store
        .read({
          calendar: createUsageCalendar(input.timeZone),
          pricer: pricing.pricer,
          sync: (writer) =>
            syncSources({
              writer,
              pool,
              input: { ...input, runtimes: knownRuntimeKindValues },
              sinceMs: null,
              first: false,
              isCancelled: isStopped,
              onProgress: null,
            }).pipe(Effect.map(({ synced }) => (checked = synced))),
          report: () => Effect.void,
        })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (checked) checks.record(checked);
            }),
          ),
        );
    },
  };
};

export type UsageIndexReader = ReturnType<typeof createUsageIndexReader>;
