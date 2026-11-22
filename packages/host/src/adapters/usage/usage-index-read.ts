import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import {
  createUsageCalendar,
  firstActivityDate,
  usageGranularity,
  usagePeriods,
} from "../../domain/usage/usage-calendar";
import {
  createUsageProjectGrouping,
  type UsageProjectGroup,
} from "../../domain/usage/usage-projects";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { UsageIndexProgress } from "@openducktor/contracts";
import type { UsageReadInput, UsageReadResult } from "../../ports/usage-index-port";
import type { UsageIndexSnapshot, UsageIndexStore, UsageIndexWriter } from "./usage-index-store";
import { codexRootOfFirstLine } from "./usage-codex-records";
import { createUsageProgressTracker } from "./usage-index-progress";
import { readFirstJsonlLine } from "./usage-jsonl-reader";
import type { UsageParsePool } from "./usage-parse-pool";
import type { UsageParseJob } from "./usage-worker-protocol";
import { USAGE_RATES_SOURCE, type UsagePricing } from "./usage-rate-catalog";
import { type Discovery, discoverUsageSources } from "./usage-source-discovery";
import { createUsageRepositoryResolver } from "./usage-repositories";
import { planUsageSync } from "./usage-sync-plan";

/** Runs an effect from a Promise callback and rejects with its original failure. */
const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

type Synced = {
  discovery: Discovery;
  checkedAtMs: number;
  /** The runtimes and the range start that the check covered. */
  scope: { runtimes: readonly RuntimeKind[]; sinceMs: number | null };
  /** True when a cancel stopped the parse before every source of the check was claimed. */
  stopped: boolean;
  /** The progress of a read that parsed sources. */
  progress: ReturnType<typeof createUsageProgressTracker> | null;
};

/** A read of a new selection uses the check of an earlier read of these last minutes. */
const CHECK_REUSE_MS = 5 * 60_000;

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
    complete: () => complete,
    record: (synced: Synced) => {
      if (synced.stopped) return;
      last = { ...synced, progress: null };
      if (
        synced.scope.sinceMs === null &&
        synced.scope.runtimes.length === knownRuntimeKindValues.length
      )
        complete = true;
    },
    /** The last check when it is recent and covers the runtimes and the range of a read. */
    reusable: (runtimes: readonly RuntimeKind[], sinceMs: number | null): Synced | null => {
      if (!last || now() - last.checkedAtMs >= CHECK_REUSE_MS) return null;
      const { scope } = last;
      if (!runtimes.every((runtime) => scope.runtimes.includes(runtime))) return null;
      const coversRange =
        complete || scope.sinceMs === null || (sinceMs !== null && sinceMs >= scope.sinceMs);
      return coversRange ? last : null;
    },
  };
};

/** What the index worker keeps between reads. */
export type UsageReadContext = {
  store: UsageIndexStore;
  pool: UsageParsePool;
  /** Resolves recorded folders to repositories, and keeps what it learned from the disk. */
  repositories: ReturnType<typeof createUsageRepositoryResolver>;
  checks: ReturnType<typeof createUsageCheckMemo>;
};

/** Reads at most this many rollout heads at once. */
const HEAD_READS = 8;

/**
 * Names the root session of each Codex rollout from its first line. A rollout whose first line
 * cannot be read counts as its own session; its parse reports the problem.
 */
const countCodexSessions = async (
  jobs: readonly Omit<UsageParseJob, "jobId">[],
  sessionOf: (jobIndex: number, session: string) => void,
): Promise<void> => {
  const indexes = jobs.flatMap((job, index) => (job.runtime === "codex" ? [index] : []));
  let next = 0;
  const reader = async () => {
    for (let index = indexes[next++]; index !== undefined; index = indexes[next++]) {
      const job = jobs[index];
      if (!job) continue;
      const line = await readFirstJsonlLine(job.path, job.format === "jsonl_zst").catch(() => null);
      sessionOf(index, (line && codexRootOfFirstLine(line)) ?? `file:${job.path}`);
    }
  };
  await Promise.all(Array.from({ length: HEAD_READS }, reader));
};

export type UsageProgressListener = (progress: UsageIndexProgress) => void;

/**
 * Removes the sources that left the disk and commits the parse of each new or changed one. A read
 * that parses sources reports its progress to `onProgress`.
 */
const syncSources = (
  writer: UsageIndexWriter,
  pool: UsageParsePool,
  input: UsageReadInput,
  sinceMs: number | null,
  isCancelled: () => boolean,
  onProgress: UsageProgressListener | null,
): Effect.Effect<Synced, HostOperationErrorAggregate | Error> =>
  Effect.gen(function* () {
    const checkedAtMs = Date.now();
    const stored = yield* writer.sources();
    // The first read of an empty index reads all history, as the page tells the user. A range or
    // runtime that the user picks during it then finds its history read, and adds no work.
    const first = stored.length === 0;
    const runtimes = first ? knownRuntimeKindValues : input.runtimes;
    const discovery = discoverUsageSources(input.locations, runtimes);
    const plan = planUsageSync({
      runtimes,
      onDisk: discovery.sources,
      unreadablePaths: discovery.unreadablePaths,
      stored,
      sinceMs: first ? null : sinceMs,
    });
    for (const sourceId of plan.removeIds) yield* writer.removeSource(sourceId);
    // Every later read needs the history of a first read, so a first read never stops early.
    const stopsEarly = first ? () => false : isCancelled;
    const progress =
      onProgress && plan.jobs.length > 0
        ? createUsageProgressTracker(plan.jobs, first, onProgress)
        : null;
    // The root sessions of Codex rollouts come from their first lines, read beside the parse.
    const codexSessions = progress ? countCodexSessions(plan.jobs, progress.sessionOf) : null;
    yield* Effect.tryPromise({
      try: () =>
        pool.run(
          plan.jobs,
          (job, result) =>
            runEffect(
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
                .pipe(Effect.tap(() => Effect.sync(() => progress?.finished(result.jobId)))),
            ),
          stopsEarly,
          (jobIndex, inside) => progress?.inside(jobIndex, inside),
        ),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (codexSessions) yield* Effect.promise(() => codexSessions);
    progress?.summarizing();
    return {
      discovery,
      checkedAtMs,
      scope: { runtimes, sinceMs: first ? null : sinceMs },
      stopped: !first && isCancelled(),
      progress,
    };
  });

/** The figures of the range, the issues, and the project groups of the recorded folders. */
const reportOf = (
  repositories: UsageReadContext["repositories"],
  snapshot: UsageIndexSnapshot,
  input: UsageReadInput,
  pricing: UsagePricing,
  { discovery, checkedAtMs }: Synced,
): Effect.Effect<UsageReadResult, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const groups = new Map<string, UsageProjectGroup>();
    const groupProjects = (paths: readonly (string | null)[]) => {
      const found = repositories(
        paths.filter((path): path is string => path !== null),
        input.workspaces.map((workspace) => workspace.repoPath),
      );
      const grouping = createUsageProjectGrouping(input.workspaces, input.separateFolders, found);
      return paths.map((path) => {
        const group = grouping(path);
        groups.set(group.key, group);
        return group.key;
      });
    };
    const earliest = yield* snapshot.earliestDates();
    const start = input.range.start ?? firstActivityDate(earliest, input.runtimes, input.range.end);
    const range = { start, end: input.range.end };
    const granularity = usageGranularity(range.start, range.end);
    const periods = usagePeriods(range.start, range.end, granularity);
    const aggregate = yield* snapshot.aggregate({
      ...range,
      runtimes: input.runtimes,
      periods,
      groupProjects,
    });
    return {
      ...aggregate,
      range,
      granularity,
      periodBounds: periods,
      issues: yield* snapshot.issues(),
      resultAtMs: checkedAtMs,
      withoutHistory: discovery.withoutHistory,
      locationIssues: discovery.locationIssues,
      projects: [...groups.values()],
      pricing: {
        source: USAGE_RATES_SOURCE,
        updatedAtMs: pricing.updatedAtMs,
        issue: pricing.issue,
      },
    };
  });

/**
 * Checks the sources of the range and its runtimes, rolls them up, and reads the report figures
 * in one write transaction of the index. A read of a new selection can use a recent check of an
 * earlier read instead. A canceled read stops new parses, and still commits the sources that its
 * parsers finished, with their rollup.
 */
export const readUsageIndex = (
  context: UsageReadContext,
  input: UsageReadInput,
  pricing: UsagePricing,
  isCancelled: () => boolean,
  onProgress: UsageProgressListener,
): Effect.Effect<UsageReadResult, HostOperationErrorAggregate | Error> => {
  const calendar = createUsageCalendar(input.timeZone);
  const sinceMs = input.range.start === null ? null : calendar.startOf(input.range.start);
  const reused = input.refresh ? null : context.checks.reusable(input.runtimes, sinceMs);
  let progress: Synced["progress"] = null;
  return context.store.read(
    calendar,
    pricing.pricer,
    (writer) =>
      reused
        ? Effect.succeed(reused)
        : syncSources(writer, context.pool, input, sinceMs, isCancelled, onProgress).pipe(
            Effect.tap((synced) =>
              Effect.sync(() => {
                progress = synced.progress;
                context.checks.record(synced);
              }),
            ),
          ),
    (snapshot, synced) => reportOf(context.repositories, snapshot, input, pricing, synced),
    (fraction) => progress?.rollup(fraction),
  );
};

/**
 * Parses the history that a read skipped: sources before its range and sources of other
 * runtimes. A later read of another range or runtime then finds its history parsed. It stops
 * claiming parse jobs as soon as `isStopped` returns true; jobs in progress still commit.
 */
export const catchUpUsageIndex = (
  context: UsageReadContext,
  input: UsageReadInput,
  pricing: UsagePricing,
  isStopped: () => boolean,
): Effect.Effect<void, HostOperationErrorAggregate | Error> =>
  context.store.read(
    createUsageCalendar(input.timeZone),
    pricing.pricer,
    (writer) =>
      syncSources(
        writer,
        context.pool,
        { ...input, runtimes: knownRuntimeKindValues },
        null,
        isStopped,
        null,
      ).pipe(Effect.tap((synced) => Effect.sync(() => context.checks.record(synced)))),
    () => Effect.void,
  );
