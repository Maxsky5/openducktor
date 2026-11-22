import type { RuntimeKind, UsageIndexProgress } from "@openducktor/contracts";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import type { UsageParseJob } from "./usage-worker-protocol";

/** Progress goes out at most this often, and at each phase change. */
const EMIT_INTERVAL_MS = 250;

type Job = Omit<UsageParseJob, "jobId">;

/** Parse work in bytes. A compressed rollout holds about 10 times its size; a database has none. */
const workOf = ({ format, fingerprint }: Job): number =>
  format === "opencode" ? 0 : format === "jsonl_zst" ? fingerprint.size * 10 : fingerprint.size;

/**
 * Counts the parse work of one read for its progress events. It sends a first event at once, so a
 * client sees the totals before the first source finishes.
 */
export const createUsageProgressTracker = (
  jobs: readonly Job[],
  emit: (progress: UsageIndexProgress) => void,
  now: () => number = Date.now,
) => {
  const startedAt = new Date(now()).toISOString();
  const runtimes = new Map<
    RuntimeKind,
    { sources: number; doneSources: number; work: number; doneWork: number; sessions: Set<string> }
  >();
  const entryOf = (runtime: RuntimeKind) => {
    let entry = runtimes.get(runtime);
    if (!entry) {
      entry = { sources: 0, doneSources: 0, work: 0, doneWork: 0, sessions: new Set() };
      runtimes.set(runtime, entry);
    }
    return entry;
  };
  for (const job of jobs) {
    const entry = entryOf(job.runtime);
    entry.sources += 1;
    entry.work += workOf(job);
  }
  let sentAt = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const snapshot = (phase: UsageIndexProgress["phase"]): UsageIndexProgress => ({
    phase,
    startedAt,
    runtimes: [...runtimes].map(([runtime, entry]) => ({
      runtime,
      sources: { done: entry.doneSources, total: entry.sources },
      work: { done: entry.doneWork, total: entry.work },
      sessions: entry.sessions.size,
    })),
  });
  const sendNow = (phase: UsageIndexProgress["phase"]) => {
    if (trailing) clearTimeout(trailing);
    trailing = null;
    sentAt = now();
    emit(snapshot(phase));
  };
  /** Sends at most once per interval. A skipped update goes out at the end of the interval. */
  const send = (phase: UsageIndexProgress["phase"], force: boolean) => {
    const wait = sentAt + EMIT_INTERVAL_MS - now();
    if (force || wait <= 0) sendNow(phase);
    else trailing ??= setTimeout(() => sendNow(phase), wait);
  };
  send("reading", true);

  return {
    /** Counts a parsed source and the sessions of its units. */
    finished: (job: Job, units: readonly UsageUnit[]) => {
      const entry = entryOf(job.runtime);
      entry.doneSources += 1;
      entry.doneWork += workOf(job);
      for (const unit of units) entry.sessions.add(unit.session);
      send("reading", false);
    },
    /** The parse ended; the rollup of the new units starts. */
    summarizing: () => send("summarizing", true),
  };
};
