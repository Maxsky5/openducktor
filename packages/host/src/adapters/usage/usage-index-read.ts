import { knownRuntimeKindValues } from "@openducktor/contracts";
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
import { resolveUsageRepositories } from "./usage-repositories";
import { planUsageSync } from "./usage-sync-plan";

/** Runs an effect from a Promise callback and rejects with its original failure. */
const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

type Synced = { discovery: Discovery; checkedAtMs: number };

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
    const discovery = discoverUsageSources(input.locations, input.runtimes);
    const plan = planUsageSync({
      runtimes: input.runtimes,
      onDisk: discovery.sources,
      unreadablePaths: discovery.unreadablePaths,
      stored: yield* writer.sources(),
      sinceMs,
    });
    for (const sourceId of plan.removeIds) yield* writer.removeSource(sourceId);
    const progress =
      onProgress && plan.jobs.length > 0 ? createUsageProgressTracker(plan.jobs, onProgress) : null;
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
          isCancelled,
          (jobIndex, inside) => progress?.inside(jobIndex, inside),
        ),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (codexSessions) yield* Effect.promise(() => codexSessions);
    progress?.summarizing();
    return { discovery, checkedAtMs };
  });

/** The figures of the range, the issues, and the project groups of the recorded folders. */
const reportOf = (
  snapshot: UsageIndexSnapshot,
  input: UsageReadInput,
  pricing: UsagePricing,
  { discovery, checkedAtMs }: Synced,
): Effect.Effect<UsageReadResult, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const groups = new Map<string, UsageProjectGroup>();
    const groupProjects = (paths: readonly (string | null)[]) => {
      const repositories = resolveUsageRepositories(
        paths.filter((path): path is string => path !== null),
        input.workspaces.map((workspace) => workspace.repoPath),
      );
      const grouping = createUsageProjectGrouping(
        input.workspaces,
        input.separateFolders,
        repositories,
      );
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
 * in one write transaction of the index. A canceled read stops new parses, and still commits the
 * sources that its parsers finished, with their rollup.
 */
export const readUsageIndex = (
  store: UsageIndexStore,
  pool: UsageParsePool,
  input: UsageReadInput,
  pricing: UsagePricing,
  isCancelled: () => boolean,
  onProgress: UsageProgressListener,
): Effect.Effect<UsageReadResult, HostOperationErrorAggregate | Error> => {
  const calendar = createUsageCalendar(input.timeZone);
  const sinceMs = input.range.start === null ? null : calendar.startOf(input.range.start);
  return store.read(
    calendar,
    pricing.pricer,
    (writer) => syncSources(writer, pool, input, sinceMs, isCancelled, onProgress),
    (snapshot, synced) => reportOf(snapshot, input, pricing, synced),
  );
};

/**
 * Parses the history that a read skipped: sources before its range and sources of other
 * runtimes. A later read of another range or runtime then finds its history parsed. It stops
 * claiming parse jobs as soon as `isStopped` returns true; jobs in progress still commit.
 */
export const catchUpUsageIndex = (
  store: UsageIndexStore,
  pool: UsageParsePool,
  input: UsageReadInput,
  pricing: UsagePricing,
  isStopped: () => boolean,
): Effect.Effect<void, HostOperationErrorAggregate | Error> =>
  store.read(
    createUsageCalendar(input.timeZone),
    pricing.pricer,
    (writer) =>
      syncSources(
        writer,
        pool,
        { ...input, runtimes: knownRuntimeKindValues },
        null,
        isStopped,
        null,
      ),
    () => Effect.void,
  );
