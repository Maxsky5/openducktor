import path from "node:path";
import type { RuntimeKind, UsageIndexProgress } from "@openducktor/contracts";
import type { OpenCodeProgress } from "./usage-opencode-reader";
import type { UsageParseJob } from "./usage-worker-protocol";

/** Progress goes out at most this often, and at each phase change. */
const EMIT_INTERVAL_MS = 250;

type Job = Omit<UsageParseJob, "jobId">;

/** Parse work in bytes. A compressed rollout holds about 10 times its size. */
const workOf = ({ format, fingerprint }: Job): number =>
  format === "jsonl_zst" ? fingerprint.size * 10 : fingerprint.size;

/**
 * The session of a Claude transcript from its path: `<session>.jsonl`, or a subagent file in
 * `<session>/subagents/`.
 */
const claudeSessionOf = (file: string): string => {
  const folder = path.dirname(file);
  return path.basename(folder) === "subagents"
    ? path.basename(path.dirname(folder))
    : path.basename(file, ".jsonl");
};

type JobState = {
  job: Job;
  finished: boolean;
  /** The session of a file source, or undefined until it is known. */
  session: string | undefined;
  /** The progress inside a database source. */
  inside: OpenCodeProgress | null;
};

/**
 * Counts the parse work of one read for its progress events: for each runtime, the share of its
 * work, and the sessions whose sources it read out of the sessions to read. A database source
 * reports its own share and sessions. It sends a first event at once, so a client sees the
 * runtimes before the first source finishes.
 */
export const createUsageProgressTracker = (
  jobs: readonly Job[],
  emit: (progress: UsageIndexProgress) => void,
  now: () => number = Date.now,
) => {
  const startedAt = new Date(now()).toISOString();
  const states: JobState[] = jobs.map((job) => ({
    job,
    finished: false,
    session: job.runtime === "claude" ? claudeSessionOf(job.path) : undefined,
    inside: null,
  }));
  const runtimes = [...new Set(jobs.map((job) => job.runtime))];

  const runtimeProgress = (runtime: RuntimeKind): UsageIndexProgress["runtimes"][number] => {
    const own = states.filter((state) => state.job.runtime === runtime);
    let weight = 0;
    let done = 0;
    // A file source counts its bytes; a database source counts as one unit of its own share.
    for (const state of own) {
      const size = state.job.format === "opencode" ? 1 : workOf(state.job);
      weight += size;
      done += size * (state.finished ? 1 : (state.inside?.fraction ?? 0));
    }
    const fileSessions = new Map<string, boolean>();
    let total: number | null = 0;
    let read = 0;
    for (const state of own) {
      if (state.job.format === "opencode") {
        const sessions = state.inside?.sessions ?? null;
        if (sessions?.total == null) total = null;
        else if (total !== null) total += sessions.total;
        read += state.finished && sessions?.total != null ? sessions.total : (sessions?.done ?? 0);
      } else if (state.session === undefined) total = null;
      else
        fileSessions.set(
          state.session,
          (fileSessions.get(state.session) ?? true) && state.finished,
        );
    }
    for (const finished of fileSessions.values()) if (finished) read += 1;
    return {
      runtime,
      progress: weight === 0 ? 1 : done / weight,
      done: own.every((state) => state.finished),
      sessions: { done: read, total: total === null ? null : total + fileSessions.size },
    };
  };

  let sentAt = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let phase: UsageIndexProgress["phase"] = "reading";
  const sendNow = () => {
    if (trailing) clearTimeout(trailing);
    trailing = null;
    sentAt = now();
    emit({ phase, startedAt, runtimes: runtimes.map(runtimeProgress) });
  };
  /** Sends at most once per interval. A skipped update goes out at the end of the interval. */
  const send = () => {
    const wait = sentAt + EMIT_INTERVAL_MS - now();
    if (wait <= 0) sendNow();
    else trailing ??= setTimeout(sendNow, wait);
  };
  sendNow();

  return {
    /** Names the session of a file source, such as the root thread of a Codex rollout. */
    sessionOf: (jobIndex: number, session: string) => {
      const state = states[jobIndex];
      if (!state) return;
      state.session = session;
      send();
    },
    /** The progress inside a database source. */
    inside: (jobIndex: number, progress: OpenCodeProgress) => {
      const state = states[jobIndex];
      if (!state) return;
      state.inside = progress;
      send();
    },
    finished: (jobIndex: number) => {
      const state = states[jobIndex];
      if (!state) return;
      state.finished = true;
      send();
    },
    /** The parse ended; the rollup of the new units starts. */
    summarizing: () => {
      phase = "summarizing";
      sendNow();
    },
  };
};
